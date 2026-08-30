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
  'codebuddy-cn': ['codebuddy.exe'],
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
const SCRIPTS_DIR = __dirname;
const LAUNCHER_FILE = path.join(SCRIPTS_DIR, 'win-launcher.js');

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
  const candidates = profileUiPortCandidates(profileId);
  const port = Array.isArray(candidates) ? candidates[0] : candidates;
  const status = await getJson(port, '/api/status', HTTP_TIMEOUT_MS);
  return !!(status && status.ok && status.profile && status.profile.id === profileId);
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
  state[id] = { launchStartedAt: 0, lastLaunchOkAt: 0, backoffUntil: 0, backoffMs: BACKOFF_BASE_MS, lastLog: '' };
}

function logOnce(profileId, key, message) {
  if (state[profileId].lastLog === key) return;
  state[profileId].lastLog = key;
  log(`[client=${getProfile(profileId).name}] ${message}`);
}

async function superviseOne(profileId) {
  const st = state[profileId];
  const now = Date.now();
  let running = clientRunning(profileId);
  if (/^codebuddy-/.test(profileId) && running) running = await codebuddyEditionAlive(profileId);

  if (!running) {
    if (st.launchStartedAt) logOnce(profileId, 'gone', '客户端已退出，放弃本次拉起');
    st.launchStartedAt = 0;
    st.backoffUntil = 0;
    st.backoffMs = BACKOFF_BASE_MS;
    return;
  }

  const alive = await daemonAlive(profileId);
  const cdp = alive ? true : await cdpAlive(profileId);
  if (alive && cdp) {
    if (st.launchStartedAt) logOnce(profileId, 'ok', 'daemon 与调试端口均就绪');
    st.launchStartedAt = 0;
    st.lastLaunchOkAt = now;
    st.backoffUntil = 0;
    st.backoffMs = BACKOFF_BASE_MS;
    return;
  }

  if (st.launchStartedAt && now - st.launchStartedAt < LAUNCH_INFLIGHT_MS) return; // 拉起进行中
  if (st.launchStartedAt && now - st.launchStartedAt >= LAUNCH_INFLIGHT_MS) {
    // 超时未就绪：进入退避，等待下一轮
    st.backoffUntil = now + st.backoffMs;
    st.backoffMs = Math.min(st.backoffMs * 2, BACKOFF_MAX_MS);
    st.launchStartedAt = 0;
    logOnce(profileId, 'timeout', 'launcher 超时未就绪，进入退避');
    return;
  }
  if (now < st.backoffUntil) return;
  if (st.lastLaunchOkAt && now - st.lastLaunchOkAt < LAUNCH_COOLDOWN_MS) return;

  logOnce(profileId, 'launch', `客户端运行中但 daemon=${alive ? '在' : '不在'}/CDP=${cdp ? '在' : '不在'}，调用 launcher 补齐`);
  const child = spawn(process.execPath, [LAUNCHER_FILE], {
    env: Object.assign({}, process.env, { WBSWITCH_PROFILE: profileId }),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (e) => log(`[client=${profileId}] launcher spawn 失败: ${e.message}`));
  child.unref();
  st.launchStartedAt = now;
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

async function main() {
  if (process.argv.includes('stop')) { stopRunning(); return; }
  if (process.platform !== 'win32') {
    console.error('supervisor 目前仅支持 Windows（macOS 沿用 launchd 方案）');
    process.exit(2);
  }
  acquireSingleInstance();
  log(`supervisor 启动 pid=${process.pid}，监管 ${SUPERVISED_PROFILES.length} 个 profile，轮询 ${POLL_MS}ms`);
  for (;;) {
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
  _tasklistImageCount: tasklistImageCount,
  _state: state,
};
