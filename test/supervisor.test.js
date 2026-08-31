'use strict';

// supervisor（方案 C 多客户端管理器）静态护栏：
// 端口/镜像名表必须与 win-launcher 保持同步，否则管理器会看错客户端。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const supervisorSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'supervisor.js'), 'utf8');
const launcherSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'win-launcher.js'), 'utf8');

test('supervisor 监管全部五个 profile', () => {
  const { getProfile, PROFILES } = require(path.join(repoRoot, 'scripts', 'profiles.js'));
  const supervisor = require(path.join(repoRoot, 'scripts', 'supervisor.js'));
  assert.deepEqual([...supervisor.SUPERVISED_PROFILES].sort(), Object.keys(PROFILES).sort());
  for (const id of supervisor.SUPERVISED_PROFILES) {
    assert.doesNotThrow(() => getProfile(id), `未知 profile: ${id}`);
  }
});

test('supervisor 的客户端镜像名与 win-launcher 的进程表一致', () => {
  const supervisor = require(path.join(repoRoot, 'scripts', 'supervisor.js'));
  // win-launcher 的 PROFILE_PROCESS_NAMES 三元链（与镜像名一一对应）
  const cn = launcherSource.match(/'workbuddy-cn' \? \[([^\]]+)\]/);
  assert.ok(cn, 'win-launcher 进程表结构变化，请同步 supervisor 与本测试');
  const ai = launcherSource.match(/'workbuddy-ai' \? \[([^\]]+)\]/);
  assert.ok(ai, 'win-launcher 进程表结构变化，请同步 supervisor 与本测试');
  const trae = launcherSource.match(/'trae-work-cn' \? \[([^\]]+)\]/);
  assert.ok(trae, 'win-launcher 进程表结构变化，请同步 supervisor 与本测试');
  const parse = (s) => s[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(supervisor.CLIENT_IMAGE_NAMES['workbuddy-cn'], parse(cn));
  assert.deepEqual(supervisor.CLIENT_IMAGE_NAMES['workbuddy-ai'], parse(ai));
  assert.deepEqual(supervisor.CLIENT_IMAGE_NAMES['trae-work-cn'], parse(trae));
});

test('supervisor 的 CDP 主端口与 win-launcher 端口表主端口一致', () => {
  const supervisor = require(path.join(repoRoot, 'scripts', 'supervisor.js'));
  for (const [profileId, ports] of Object.entries(supervisor.CDP_PRIMARY_PORT)) {
    const m = launcherSource.match(new RegExp(`'${profileId}': \\[([0-9, ]+)\\]`));
    assert.ok(m, `win-launcher 缺少 ${profileId} 的 CDP 端口表`);
    assert.equal(ports, Number(m[1].split(',')[0].trim()), `${profileId} 的 CDP 主端口与 win-launcher 不一致`);
  }
});

test('supervisor 必须独立探测 CDP 端口，不得因 daemon 存活而短路', () => {
  // 回归护栏：CDP 调试端口是客户端(启动参数)的属性，与 daemon 进程是否存活无关。
  // 曾写成 `const cdp = alive ? true : await cdpAlive(profileId)`，daemon 在跑时被
  // 当作 CDP 就绪，导致 Trae 被用户/崩溃后裸启动(无 --remote-debugging-port)时
  // 管理器一直不补齐，悬浮窗注入不回来。
  assert.doesNotMatch(supervisorSource, /alive \? true\s*:\s*await cdpAlive/);
  assert.doesNotMatch(supervisorSource, /cdp = alive \? true\b/);
  // 必须无条件对每个受监管 profile 探测 CDP 主端口
  assert.match(supervisorSource, /const cdp = await cdpAlive\(profileId\);/);
  // 补齐条件仍是「daemon 或 CDP 任一不可用」
  assert.match(supervisorSource, /if \(alive && cdp\)\s*\{/);
});

test('supervisor daemonAlive 必须遍历候选端口，不只查主端口', () => {
  // 回归护栏：daemon 启动时主端口被占会落到回退段并持久化（ui-port.json），
  // 只查 candidates[0] 会让管理器永久判「daemon=不在」→ 每轮拉起 / launcher 已就绪 →
  // 超时退避 → 高频重启抖动。线上实机（daemon 落 17832）即因此反复重启。
  assert.doesNotMatch(supervisorSource, /candidates\[0\]/);
  assert.match(supervisorSource, /for \(const port of ports\)/);
  assert.match(supervisorSource, /return true;[\s\S]*return false;/);
});

test('supervisor 只补齐不杀伤：拉起走 win-launcher 且带 profile 环境变量', () => {
  assert.match(supervisorSource, /LAUNCHER_FILE/);
  assert.match(supervisorSource, /WBSWITCH_PROFILE: profileId/);
  // 不做宽名杀伤：进程查询只按精确镜像名（tasklist IMAGENAME eq）
  assert.match(supervisorSource, /IMAGENAME eq \$\{imageName\}/);
  // codebuddy 双版共用镜像名：必须依赖 CDP 端口判别版本，未判别时保持沉默
  assert.match(supervisorSource, /codebuddyEditionAlive/);
  // 单实例锁 + stop 子命令
  assert.match(supervisorSource, /supervisor\.pid/);
  assert.match(supervisorSource, /includes\('stop'\)/);
});

test('supervisor 支持 open/status 子命令，意图并入单例去重', () => {
  // open 子命令：托盘/CLI 写命令文件，常驻 supervisor 消费
  assert.match(supervisorSource, /process\.argv\.indexOf\('open'\)/);
  assert.match(supervisorSource, /enqueueOpen/);
  assert.match(supervisorSource, /open\.\$\{profileId\}\.\$\{Date\.now\(\)\}\.json/);
  // 消费意图后置入对应 profile 的 forceOpen，交由单例拉起状态统一处理
  assert.match(supervisorSource, /\.forceOpen = true;/);
  // 拉起进行中(LAUNCH_INFLIGHT)时尊重单例去重，不因显式打开抢占同一进程树
  assert.match(supervisorSource, /launchStartedAt && now - st\.launchStartedAt < LAUNCH_INFLIGHT_MS/);
  // status 子命令：输出三态快照（正常运行/待补齐/未知/未运行）
  assert.match(supervisorSource, /includes\('status'\)/);
  assert.match(supervisorSource, /profileStatus/);
  assert.match(supervisorSource, /'normal' : 'pending'/);
  // CodeBuddy 双版共用镜像名、无 CDP 时标注未知而非冒充确定状态
  assert.match(supervisorSource, /\/\^codebuddy-\/\.test\(profileId\) \? 'unknown'/);
});

test('supervisor 守护托盘宿主：只按托盘自报 PID 拉起，不杀伤', () => {
  assert.match(supervisorSource, /TRAY_PID_FILE/);
  assert.match(supervisorSource, /TRAY_SCRIPT/);
  assert.match(supervisorSource, /supervisor-tray\.ps1/);
  // liveness 以托盘写下的 PID 为准，tasklist 精确按 PID 过滤（不做宽名匹配）
  assert.match(supervisorSource, /PID eq \$\{pid\}/);
  // 拉起退避：托盘崩溃后按 TRAY_RESPAWN_COOLDOWN_MS 再补，避免循环刷进程
  assert.match(supervisorSource, /TRAY_RESPAWN_COOLDOWN_MS/);
  assert.match(supervisorSource, /\-File', TRAY_SCRIPT/);
});

test('托盘脚本只「打开」不杀伤，且带路径校验与单实例', () => {
  const tray = fs.readFileSync(path.join(repoRoot, 'scripts', 'supervisor-tray.ps1'), 'utf8');
  // 点击菜单项 → 把「打开某客户端」意图交给 supervisor open，不直连 launcher
  assert.match(tray, /open \{1\}/);
  // 不做退出/强杀/跨 profile 操作（托盘只「打开」）
  assert.doesNotMatch(tray, /Stop-Process/);
  assert.doesNotMatch(tray, /taskkill/i);
  assert.match(tray, /supervisor-tray\.pid/);
  // fail-closed：supervisor 必须位于安装 scripts 目录内才允许启动
  assert.match(tray, /Supervisor script is outside the installed scripts directory/);
});
