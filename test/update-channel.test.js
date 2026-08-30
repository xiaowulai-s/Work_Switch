'use strict';

// 静态断言：自动更新渠道按 profile 声明（平台无关的 daemon 源码约束）。
// 背景：旧实现用 PROFILE.id === 'workbuddy-ai' 二值判断资产前缀，codebuddy-* / trae-* 会
// 误选 WorkDaddy CN 的 Setup.exe/ZIP；改为 UPDATE_CHANNEL 声明制，未登记渠道的 profile
// 完全禁用更新检查/下载/安装。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptsDir = path.join(__dirname, '..', 'scripts');
const daemonSource = fs.readFileSync(path.join(scriptsDir, 'daemon.js'), 'utf8');
const launcherSource = fs.readFileSync(path.join(scriptsDir, 'win-launcher.js'), 'utf8');

test('自动更新渠道按 profile 声明，无渠道 profile 禁用更新检查与下载/安装', () => {
  // v0.3.0 起发布物收敛为全端单包：CN/AI 通道都解析 WorkSwitch-All-Setup-*；
  // 旧 CN 分身经自身旧代码的兜底正则可匹配 All 资产升级；旧 AI 分身需手动安装一次。
  assert.match(daemonSource, /const UPDATE_CHANNEL = PROFILE\.id === 'workbuddy-ai' \|\| PROFILE\.id === 'workbuddy-cn' \? 'WorkSwitch-All-'/);
  assert.match(daemonSource, /profileSetup = \/\^WorkSwitch-All-Setup-/);
  assert.match(daemonSource, /profileAsset = \/\^WorkSwitch-All-/);
  assert.doesNotMatch(daemonSource, /\^WorkSwitch-Setup-\d/);
  assert.doesNotMatch(daemonSource, /WorkSwitch-AI-Setup-/);
  assert.match(daemonSource, /const UPDATE_CHANNEL = [\s\S]*?: null;/);
  // checkUpdate 短路：无渠道不请求 Releases API
  assert.match(daemonSource, /function checkUpdate\(force\) \{[\s\S]{0,220}?if \(!UPDATE_CHANNEL\) \{/);
  // 下载/安装路由双重拒绝
  assert.equal((daemonSource.match(/if \(!UPDATE_CHANNEL\) return json\(res, 400/g) || []).length, 2);
});

test('Trae Work CN 绑定独立端口段（CDP 9240 / UI 47836），不落入 workbuddy 回退段', () => {
  assert.match(daemonSource, /'trae-work-cn': 9240/);
  assert.match(launcherSource, /'trae-work-cn': \[9240\]/);
  // workbuddy-cn 的 CDP 回退候选必须止步于 9232，不得延伸到 9240 段（逐行精确匹配）
  assert.match(launcherSource, /^  'workbuddy-cn': \[9222, 9226, 9227, 9228, 9229, 9230, 9231, 9232\],$/m);
});

test('Trae Work CN 的进程镜像名走精确匹配（trae solo cn.exe）', () => {
  assert.match(daemonSource, /PROFILE\.id === 'trae-work-cn' \? \['trae solo cn\.exe'\]/);
  assert.equal((launcherSource.match(/PROFILE\.id === 'trae-work-cn' \? \['trae solo cn\.exe'\]/g) || []).length, 2);
});
