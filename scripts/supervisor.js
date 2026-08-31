#!/usr/bin/env node
/**
 * WorkSwitch 多客户端管理器（Windows，方案 C：单安装包 + 按需拉起）
 *
 * 职责（只做三件事）：
 *   1. 轮询检测受支持客户端是否正在运行（按精确镜像名，不做宽名匹配）
 *   2. 该客户端的 daemon 或 CDP 主端口不可用时，调用 win-launcher 补齐——launcher
 *      自身幂等：daemon 已在→只注入；客户端未开调试端口→精确重启带 --remote-debugging-port
 *   3. 客户端未运行时不做任何事。daemon 一旦拉起即常驻（watchdog 托管），与分身版语义一致
 *
 * 不做：客户端退出后停 daemon；任何跨 profile 的进程操作；提权（launcher 内部
 * 对 elevated 会自动降级到桌面 Shell 或 fail-closed）。
 *
 * CodeBuddy 双版共用 codebuddy.exe 镜像名，无法从进程名区分国行/国际：
 * 仅当其 CDP 主端口（9224/9225）已可响应时才判定在运行并补齐 daemon；
 * 用户普通方式启动且无调试端口时保持沉默（宁缺勿错）。
 *
 * 用法: node supervisor.js
 *       node supervisor.js stop   # 停止管理器自身（不影响已拉起的 daemon）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { getProfile } = require('./profiles.js');
const { profileUiPortCandidates } = require('./ui-port.js');

const SUPERVISED_PROFILES = [
  'workbuddy-cn',
  'workbuddy-ai',
  'codebuddy-cn',
  'codebuddy-intl',
  'trae-work-cn',
];

// 与 win-launcher.js 的 PROFILE_PROCESS_NAMES / PROFILE_CDP_PORTS 主端口保持一致
// （test/trae-models.test.js 所在目录下的 supervisor 静态护栏断言两者同步）
const CLIENT_IMAGE_NAMES = {
  'workbuddy-cn': ['workbuddy.exe'],
  'workbuddy-ai': ['workbuddyai.exe'],
  // CodeBuddy CN 1.106+ 的镜像名为 codebuddy cn.exe（与 intl 的 codebuddy.exe 可区分）
  'codebuddy-cn': ['codebuddy cn.exe'],
  'codebuddy-intl': ['codebuddy.exe'],
  'trae-work-cn': ['trae solo cn.exe'],
};
const CDP_PRIMARY_PORT = {
  'workbuddy-cn': 9222,
  'workbuddy-ai': 9223,
  'codebuddy-cn': 9224,
  'codebuddy-intl': 9225,
  'trae-work-cn': 9240,
};

const POLL_MS = 10000;
const HTTP_TIMEOUT_MS = 1500;
const LAUNCH_INFLIGHT_MS = 240000; // launcher 全流程（含客户端重启+注入）的最长等待
const LAUNCH_COOLDOWN_MS = 30000; // 一次拉起成功后的最短再触发间隔
const BACKOFF_BASE_MS = 30000; // 拉起失败后的退避基数（指数递增）
const BACKOFF_MAX_MS = 600000;

const ROOT_DATA_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'WorkDaddy');
const PID_FILE = path.join(ROOT_DATA_DIR, 'supervisor.pid');
const LOG_FILE = path.join(ROOT_DATA_DIR, 'supervisor.log');
// 跨进程「打开某客户端」意图队列：托盘/CLI 写命令文件，常驻 supervisor 消费后并入其
// 单例拉起状态（LAUNCH_INFLIGHT 去重），避免另一路 launcher 抢占同一客户端进程树。
const COMMANDS_DIR = path.join(ROOT_DATA_DIR, 'commands');
const SCRIPTS_DIR = __dirname;
const LAUNCHER_FILE = path.join(SCRIPTS_DIR, 'win-launcher.js');
// 托盘宿主：由 supervisor 本机拉起并保住（守护联动）。托盘写入自己的 PID，
// supervisor 据此判断其是否仍在运行，缺失时按退避补拉起，避免托盘崩溃后入口丢失。
const TRAY_PID_FILE = path.join(ROOT_DATA_DIR, 'supervisor-tray.pid');
const TRAY_SCRIPT = path.join(SCRIPTS_DIR, 'supervisor-tray.ps1');
const TRAY_RESPAWN_COOLDOWN_MS = 60000; // 托盘拉起失败/崩溃后的再尝试间隔

function log(...args) {
  const line = `[supervisor] ${new Date().toISOString()} ${args.join(' ')}\n`;
  try { process.stdout.write(line); } catch (_) {}
  try { fs.mkdirSync(ROOT_DATA_DIR, { recursive: true }); fs.appendFileSync(LOG_FILE, line); } catch (_) {}
}

function getJson(port, apiPath, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: apiPath, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function daemonAlive(profileId) {
  // daemon 启动时若主端口被占用会落到同 profile 回退段并持久化（ui-port.json），
  // 因此探测不能只看主端口——须遍历全部候选，任一端口返回本 profile 状态即视为存活。
  // 只查主端口曾导致：daemon 落在 178xx 时管理器永久判「daemon=不在」→ 每轮拉起、
  // launcher 却按持久化端口发现已就绪 → 超时退避 → 高频重启抖动。
  const candidates = profileUiPortCandidates(profileId);
  const ports = Array.isArray(candidates) ? candidates : [candidates];
  for (const port of ports) {
    const status = await getJson(port, '/api/status', HTTP_TIMEOUT_MS);
    if (status && status.ok && status.profile && status.profile.id === profileId) return true;
  }
  return false;
}

async function cdpAlive(profileId) {
  const status = await getJson(CDP_PRIMARY_PORT[profileId], '/json/version', HTTP_TIMEOUT_MS);
  return !!(status && status.Browser);
}

function tasklistImageCount(imageName) {
  const result = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8', timeout: 8000, windowsHide: true,
  });
  if (result.error || result.status !== 0) return 0;
  // CSV 输出中每个匹配进程一行且以引号开头；无匹配时是本地化的「信息:/INFO:」行
  return String(result.stdout || '').split('\n').filter((l) => l.trim().startsWith('"')).length;
}

function clientRunning(profileId) {
  if (process.platform !== 'win32') return false;
  const names = CLIENT_IMAGE_NAMES[profileId] || [];
  for (const name of names) {
    if (tasklistImageCount(name) > 0) return true;
  }
  return false;
}

// codebuddy 双版共用镜像名：只有 CDP 主端口能响应（说明该版已带调试端口在跑）时才认定
function codebuddyEditionAlive(profileId) {
  return cdpAlive(profileId);
}

const state = {};
for (const id of SUPERVISED_PROFILES) {
  state[id] = { launchStartedAt: 0, lastLaunchOkAt: 0, backoffUntil: 0, backoffMs: BACKOFF_BASE_MS, lastLog: '', forceOpen: false };
}

function logOnce(profileId, key, message) {
  if (state[profileId].lastLog === key) return;
  state[profileId].lastLog = key;
  log(`[client=${getProfile(profileId).name}] ${message}`);
}

// 把「打开某客户端」的意图写入命令文件，交给常驻 supervisor 消费。托盘/CLI 独立进程
// 调用（`node supervisor.js open <profile>`），真正拉起由其内存态去重，避免双路 launcher。
function enqueueOpen(profileId) {
  if (!SUPERVISED_PROFILES.includes(profileId)) return false;
  try {
    fs.mkdirSync(COMMANDS_DIR, { recursive: true });
    const file = path.join(COMMANDS_DIR, `open.${profileId}.${Date.now()}.json`);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ profile: profileId, ts: Date.now() }));
    fs.renameSync(tmp, file);
    return true;
  } catch (_) {
    return false;
  }
}

// 常驻轮询前调用：消费 open 意图，置入对应 profile 的单例状态。
function drainOpenIntents() {
  let files;
  try { files = fs.readdirSync(COMMANDS_DIR); } catch (_) { return; }
  for (const name of files) {
    if (!/^open\..+\.\d+\.json$/.test(name)) continue;
    const file = path.join(COMMANDS_DIR, name);
    let intent = null;
    try { intent = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { intent = null; }
    try { fs.unlinkSync(file); } catch (_) {}
    if (intent && SUPERVISED_PROFILES.includes(intent.profile)) {
      state[intent.profile].forceOpen = true;
      log(`[client=${getProfile(intent.profile).name}] 收到显式打开意图`);
    }
  }
}

function launchForProfile(profileId) {
  const child = spawn(process.execPath, [LAUNCHER_FILE], {
    env: Object.assign({}, process.env, { WBSWITCH_PROFILE: profileId }),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (e) => log(`[client=${profileId}] launcher spawn 失败: ${e.message}`));
  child.unref();
  state[profileId].launchStartedAt = Date.now();
}

async function superviseOne(profileId) {
  const st = state[profileId];
  const now = Date.now();
  let running = clientRunning(profileId);
  if (/^codebuddy-/.test(profileId) && running) running = await codebuddyEditionAlive(profileId);
  const forceOpen = st.forceOpen;

  if (!running) {
    if (forceOpen && now - st.launchStartedAt >= LAUNCH_INFLIGHT_MS) {
      // 显式打开：客户端未运行也冷启动一次（launcher 以调试端口拉起），不重复发起。
      logOnce(profileId, 'open', `显式打开未运行客户端，调用 launcher 冷启动`);
      st.forceOpen = false;
      launchForProfile(profileId);
      return;
    }
    if (st.launchStartedAt) logOnce(profileId, 'gone', '客户端已退出，放弃本次拉起');
    st.launchStartedAt = 0;
    st.backoffUntil = 0;
    st.backoffMs = BACKOFF_BASE_MS;
    st.forceOpen = false;
    return;
  }

  const alive = await daemonAlive(profileId);
  const cdp = await cdpAlive(profileId);
  if (alive && cdp) {
    if (st.launchStartedAt) logOnce(profileId, 'ok', 'daemon 与调试端口均就绪');
    st.launchStartedAt = 0;
    st.lastLaunchOkAt = now;
    st.backoffUntil = 0;
    st.backoffMs = BACKOFF_BASE_MS;
    st.forceOpen = false;
    return;
  }

  // 拉起进行中：无论是否显式打开，都尊重单例去重，避免抢占同一进程树。
  if (st.launchStartedAt && now - st.launchStartedAt < LAUNCH_INFLIGHT_MS) return;
  if (st.launchStartedAt && now - st.launchStartedAt >= LAUNCH_INFLIGHT_MS) {
    // 超时未就绪：进入退避，等待下一轮
    st.backoffUntil = now + st.backoffMs;
    st.backoffMs = Math.min(st.backoffMs * 2, BACKOFF_MAX_MS);
    st.launchStartedAt = 0;
    logOnce(profileId, 'timeout', 'launcher 超时未就绪，进入退避');
    if (forceOpen) { st.forceOpen = false; return; }
  }
  if (!forceOpen && now < st.backoffUntil) return;
  if (!forceOpen && st.lastLaunchOkAt && now - st.lastLaunchOkAt < LAUNCH_COOLDOWN_MS) return;

  const reason = forceOpen ? '显式打开' : `客户端运行中但 daemon=${alive ? '在' : '不在'}/CDP=${cdp ? '在' : '不在'}`;
  logOnce(profileId, forceOpen ? 'launch' : 'launch', `${reason}，调用 launcher 补齐`);
  st.forceOpen = false;
  launchForProfile(profileId);
}

// 三态快照：正常运行 / 待补齐 / 未知 / 未运行。CodeBuddy 双版共用镜像名但无 CDP 时
// 无法确认该版在跑，标注未知而非冒充确定状态。
async function profileStatus(profileId) {
  let running = clientRunning(profileId);
  if (/^codebuddy-/.test(profileId) && running) running = await codebuddyEditionAlive(profileId);
  if (!running) return { running: false, status: /^codebuddy-/.test(profileId) ? 'unknown' : 'not_running', daemon: false, cdp: false };
  const alive = await daemonAlive(profileId);
  const cdp = await cdpAlive(profileId);
  const status = alive && cdp ? 'normal' : 'pending';
  return { running: true, status, daemon: alive, cdp };
}

function readPid() {
  try { return Number(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch (_) { return 0; }
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function acquireSingleInstance() {
  const existing = readPid();
  if (existing && existing !== process.pid && pidAlive(existing)) {
    console.error(`supervisor 已在运行（pid=${existing}），退出`);
    process.exit(0);
  }
  fs.mkdirSync(ROOT_DATA_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function stopRunning() {
  const pid = readPid();
  if (pid && pidAlive(pid)) {
    try { process.kill(pid); log(`已停止 supervisor (pid=${pid})`); } catch (_) {}
  } else {
    log('没有运行中的 supervisor');
  }
}

async function printStatus() {
  const now = Date.now();
  const profiles = {};
  for (const id of SUPERVISED_PROFILES) {
    const st = state[id];
    const s = await profileStatus(id);
    profiles[id] = { name: getProfile(id).name, ...s, inflight: !!(st.launchStartedAt && now - st.launchStartedAt < LAUNCH_INFLIGHT_MS) };
  }
  process.stdout.write(JSON.stringify({ ok: true, ts: now, profiles }));
}

let trayLastSpawnAt = 0;

function isProcessAliveByPid(pid) {
  if (process.platform !== 'win32' || !pid) return false;
  const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8', timeout: 8000, windowsHide: true,
  });
  return result.status === 0 && String(result.stdout || '').includes(`"${pid}"`);
}

function trayRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const pid = parseInt(String(fs.readFileSync(TRAY_PID_FILE, 'utf8') || '').trim(), 10);
    return isProcessAliveByPid(pid);
  } catch (_) {
    return false;
  }
}

// 守护联动：托盘是「选客户端启动」的入口宿主，随 supervisor 常驻并被保住。
// 托盘崩溃或被误关后，这里按退避补拉起；liveness 以托盘自报 PID 为准，绝不宽匹配杀进程。
function ensureTrayRunning(now = Date.now()) {
  if (process.platform !== 'win32') return;
  if (trayRunning()) { trayLastSpawnAt = 0; return; }
  if (now - trayLastSpawnAt < TRAY_RESPAWN_COOLDOWN_MS) return;
  trayLastSpawnAt = now;
  const pwsh = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const sup = path.join(SCRIPTS_DIR, 'supervisor.js');
  const child = spawn(pwsh, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TRAY_SCRIPT, '-NodePath', process.execPath, '-SupervisorPath', sup], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (e) => log(`托盘 spawn 失败: ${e.message}`));
  child.unref();
  log('托盘未在运行，已尝试拉起（由 supervisor 守护）');
}

async function main() {
  if (process.argv.includes('stop')) { stopRunning(); return; }
  const openIndex = process.argv.indexOf('open');
  if (openIndex >= 0) {
    const profileId = process.argv[openIndex + 1];
    if (!SUPERVISED_PROFILES.includes(profileId)) {
      console.error(`未知 profile: ${profileId}，可用：${SUPERVISED_PROFILES.join(', ')}`);
      process.exit(2);
    }
    if (enqueueOpen(profileId)) {
      process.stdout.write(JSON.stringify({ ok: true, accepted: profileId, note: '意图已入队，由常驻 supervisor 拉起' }) + '\n');
    } else {
      console.error(`open ${profileId} 入队失败`);
      process.exit(1);
    }
    return;
  }
  if (process.argv.includes('status')) {
    await printStatus();
    process.stdout.write('\n');
    return;
  }
  if (process.platform !== 'win32') {
    console.error('supervisor 目前仅支持 Windows（macOS 沿用 launchd 方案）');
    process.exit(2);
  }
  acquireSingleInstance();
  log(`supervisor 启动 pid=${process.pid}，监管 ${SUPERVISED_PROFILES.length} 个 profile，轮询 ${POLL_MS}ms`);
  try { ensureTrayRunning(); } catch (e) { log(`托盘初始化异常: ${(e && e.message) || e}`); }
  for (;;) {
    try { drainOpenIntents(); } catch (e) { log(`命令消费异常: ${(e && e.message) || e}`); }
    try { ensureTrayRunning(); } catch (e) { log(`托盘守护异常: ${(e && e.message) || e}`); }
    for (const id of SUPERVISED_PROFILES) {
      try { await superviseOne(id); } catch (e) { log(`[client=${id}] 轮询异常: ${(e && e.message) || e}`); }
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

if (require.main === module) main();

module.exports = {
  SUPERVISED_PROFILES,
  CLIENT_IMAGE_NAMES,
  CDP_PRIMARY_PORT,
  daemonAlive,
  cdpAlive,
  clientRunning,
  enqueueOpen,
  drainOpenIntents,
  profileStatus,
  ensureTrayRunning,
  trayRunning,
  _tasklistImageCount: tasklistImageCount,
  _state: state,
};
