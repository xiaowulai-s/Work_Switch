'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PROFILES, getProfile, profileDataDir } = require('../scripts/profiles.js');

test('五个客户端 profile 使用独立数据源和能力开关', () => {
  assert.deepEqual(Object.keys(PROFILES).sort(), ['codebuddy-cn', 'codebuddy-intl', 'trae-work-cn', 'workbuddy-ai', 'workbuddy-cn']);
  assert.equal(getProfile('workbuddy-ai').sessionDb.endsWith(path.join('.workbuddy-ai', 'workbuddy.db')), true);
  assert.equal(getProfile('codebuddy-cn').sessionDb.endsWith(path.join('CodeBuddy CN', 'codebuddy-sessions.vscdb')), true);
  assert.equal(getProfile('codebuddy-intl').sessionDb.endsWith(path.join('CodeBuddy', 'codebuddy-sessions.vscdb')), true);
  assert.equal(getProfile('workbuddy-cn').capabilities.theme, true);
  assert.equal(getProfile('workbuddy-ai').capabilities.theme, true);
  assert.equal(getProfile('codebuddy-cn').capabilities.stashPrompt, false);
  assert.equal(getProfile('codebuddy-cn').authFile, null);
});

test('Trae Work CN profile：kind=trae、能力组合、Windows 实机 exe 路径', () => {
  const trae = getProfile('trae-work-cn');
  assert.equal(trae.kind, 'trae');
  assert.equal(trae.appName, 'WorkSwitch Trae');
  assert.equal(trae.authFile, null);
  assert.equal(trae.apiHost, 'https://www.trae.cn');
  // 会话只读（渲染层收集器）；账号/模型/主题待后续适配
  assert.deepEqual(trae.capabilities, {
    accounts: false, sessions: true, models: false, stashPrompt: false, theme: false, checkin: false,
  });
  if (process.platform === 'win32') {
    assert.equal(trae.appPath.endsWith(path.join('TRAE SOLO CN', 'TRAE SOLO CN.exe')), true);
    assert.equal(trae.dataRoot.endsWith(path.join('TRAE SOLO CN')), true);
    assert.equal(trae.sessionDb.endsWith(path.join('TRAE SOLO CN', 'User', 'globalStorage', 'state.vscdb')), true);
  }
  // 数据目录与既有 profile 隔离
  assert.equal(profileDataDir(trae), path.join(profileDataDir(getProfile('workbuddy-cn')), 'profiles', 'trae-work-cn'));
});

test('Trae 会话收集器随 kind 注入（渲染层 React fiber 读取）', () => {
  const injectSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'inject.js'), 'utf8');
  // kind 维度占位符存在且被收集器门控使用
  assert.match(injectSource, /'__WBS_PROFILE_KIND__' === 'trae'/);
  assert.match(injectSource, /window\.__wbsTraeSessions = function/);
  // 收集器必须在 __wbsWidget 守卫之前安装（重注入时随脚本更新）
  const installIndex = injectSource.indexOf('window.__wbsTraeSessions = function');
  const guardIndex = injectSource.indexOf('if (window.__wbsWidget) return;');
  assert.ok(installIndex >= 0 && guardIndex > installIndex, 'collector must install before the widget guard');
});

test('WorkBuddy AI enables the theme capability alongside domestic WorkBuddy', () => {
  assert.equal(PROFILES['workbuddy-cn'].capabilities.theme, true);
  assert.equal(PROFILES['workbuddy-ai'].capabilities.theme, true);
  assert.equal(PROFILES['codebuddy-cn'].capabilities.theme, false);
  assert.equal(PROFILES['codebuddy-intl'].capabilities.theme, false);
});

test('各 profile 的 API host 与 auth.domain 一致（签到/积分/无感登录）', () => {
  assert.equal(getProfile('workbuddy-cn').apiHost, 'https://www.codebuddy.cn');
  assert.equal(getProfile('workbuddy-ai').apiHost, 'https://www.workbuddy.ai');
  assert.equal(getProfile('codebuddy-cn').apiHost, 'https://www.codebuddy.cn');
  assert.equal(getProfile('codebuddy-intl').apiHost, 'https://www.codebuddy.ai');
});

test('默认 WorkBuddy 数据目录保持兼容，其他 profile 隔离到子目录', () => {
  const cn = getProfile('workbuddy-cn');
  const ai = getProfile('workbuddy-ai');
  const cnDataDir = profileDataDir(cn);
  const aiDataDir = profileDataDir(ai);
  assert.equal(path.basename(cnDataDir), 'WorkDaddy');
  assert.equal(path.relative(cnDataDir, aiDataDir), path.join('profiles', 'workbuddy-ai'));
});
