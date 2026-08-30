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
