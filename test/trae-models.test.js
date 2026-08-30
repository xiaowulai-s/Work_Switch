'use strict';

// Trae 在线模型能力（列表/切换）的静态护栏：能力开关、渲染层收集器、daemon 路由。
// 运行时行为（下拉展开/收割/切换）无法在无 Trae 实机时验证，见交接文档的平台验证说明。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const injectSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'inject.js'), 'utf8');
const daemonSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'daemon.js'), 'utf8');

test('Trae 模型收集器随 kind 注入且在 widget 守卫之前安装', () => {
  assert.match(injectSource, /window\.__wbsTraeModels = \{/);
  const installIndex = injectSource.indexOf('window.__wbsTraeModels = {');
  const guardIndex = injectSource.indexOf('if (window.__wbsWidget) return;');
  assert.ok(installIndex >= 0 && guardIndex > installIndex, 'collector must install before the widget guard');
  // 收集器必须挂在整个文件顶部（重注入时随脚本整体覆盖，不能落在守卫 return 之后）
  const sessionCollectorIndex = injectSource.indexOf('window.__wbsTraeSessions = function');
  assert.ok(sessionCollectorIndex >= 0 && installIndex > sessionCollectorIndex, 'models collector sits beside the sessions collector');
});

test('收集器派发的指针事件必须显式 mouse（Radix 校验 pointerType）', () => {
  const collector = injectSource.slice(
    injectSource.indexOf('window.__wbsTraeModels = {'),
    injectSource.indexOf('window.__wbsWidget') > 0 ? injectSource.indexOf('if (window.__wbsWidget) return;') : undefined
  );
  assert.match(collector, /pointerType: 'mouse'/);
  // Auto Mode 是独立入口（不在 [role=option] 里），切换与还原都必须覆盖
  assert.match(collector, /core-model-select-auto-mode-item/);
  assert.match(collector, /core-model-select-trigger/);
  assert.match(collector, /core-model-select-model-item-trail/);
  assert.match(collector, /core-model-select-model-group-label/);
  // 操作完成后必须恢复原状：关闭展开过的下拉
  assert.match(collector, /_closeDropdown/);
});

test('Trae 模型路由仅对 kind=trae 开放且表达式经 JSON 序列化注入', () => {
  assert.match(daemonSource, /p === '\/api\/trae\/models'/);
  assert.match(daemonSource, /p === '\/api\/trae\/models\/switch'/);
  const routeIndex = daemonSource.indexOf("p === '/api/trae/models'");
  const kindGuard = daemonSource.indexOf("PROFILE.kind !== 'trae'", routeIndex);
  assert.ok(kindGuard > routeIndex, 'routes must fail closed for non-trae profiles');
  // switch 表达式里的 key 必须 JSON.stringify，禁止字符串拼接出可执行代码
  assert.match(daemonSource, /switchTo\(' \+ JSON\.stringify\(/);
  // 收集器是异步的（临时展开下拉），Runtime.evaluate 必须等待 Promise
  assert.match(daemonSource, /awaitPromise: true/);
});

test('Trae 模型页走专属 API 且不复用 WorkBuddy 配置管理的 DOM id', () => {
  assert.match(injectSource, /if \(WBS_PROFILE_KIND === 'trae'\) \{\s*buildTraeModelsPane\(\);/);
  assert.match(injectSource, /api\('\/api\/trae\/models'\)/);
  assert.match(injectSource, /api\('\/api\/trae\/models\/switch'/);
  // update-layout.test.js 已断言 WorkBuddy 的 wbs-model-refresh 不存在；Trae 刷新按钮不得撞名
  assert.doesNotMatch(injectSource, /id="wbs-model-refresh"/);
  assert.match(injectSource, /id="wbs-trae-model-refresh"/);
});
