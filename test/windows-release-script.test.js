'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'scripts', 'build-win-release.ps1');
const launcherPath = path.join(__dirname, '..', 'scripts', 'build-win-release.cmd');
const hiddenLauncherPath = path.join(__dirname, '..', 'scripts', 'launcher-hidden.vbs');
const standardRelaunchPath = path.join(__dirname, '..', 'scripts', 'windows-relaunch-standard.ps1');
const scriptBytes = fs.readFileSync(scriptPath);
const source = scriptBytes.toString('utf8');
const launcher = fs.readFileSync(launcherPath, 'utf8');
const hiddenLauncherBytes = fs.readFileSync(hiddenLauncherPath);
const standardRelaunchBytes = fs.readFileSync(standardRelaunchPath);

test('Windows release script interactively builds all profiles for one version', () => {
  assert.deepEqual([...scriptBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell 5.1 needs a UTF-8 BOM for Chinese prompts');
  assert.match(source, /Read-Host\s+"[^"]*版本号/);
  assert.match(source, /\$Version -notmatch '\^\\d\+\\\.\\d\+\\\.\\d\+\$'/);
  assert.match(source, /foreach \(\$profile in @\('all'\)\)/); // v0.3.0 起只发全端包
  assert.match(source, /build-win-zip\.sh/);
  assert.match(source, /build-win-installer\.ps1/);
  assert.match(source, /-IsccPath \$Compiler \| Out-Host/);
  assert.match(source, /WORKDADDY_BUILD_PROFILE/);
  assert.match(source, /-Version \$ReleaseVersion/);
  // all 是全端包名即 WorkSwitch-All；若映射里漏掉 all 分支会落成 WorkSwitch，
  // 导致校验查找 WorkSwitch-Setup-<ver>.exe 而产物实为 WorkSwitch-All-Setup-<ver>.exe。
  assert.match(source, /\$Profile -eq 'all'\) \{ 'WorkSwitch-All' \}/);
  assert.match(launcher, /build-win-release\.ps1/);
  assert.match(launcher, /ExecutionPolicy Bypass/);
});

test('Windows hidden launcher stays parseable under WSH code pages', () => {
  assert.equal(hiddenLauncherBytes.some((byte) => byte >= 0x80), false);
});

test('Windows standard relaunch script is UTF-8 with BOM for Windows PowerShell 5.1', () => {
  assert.deepEqual([...standardRelaunchBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('supervisor tray host is UTF-8 with BOM for Windows PowerShell 5.1', () => {
  // 含中文菜单文案的 ps1 若无 BOM，会在 Windows PowerShell 5.1 下按系统代码页(GBK)
  // 解析导致 ParserError，托盘启动即崩、PID 文件不写、图标不显示。
  const trayBytes = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'supervisor-tray.ps1'));
  assert.deepEqual([...trayBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(trayBytes.toString('utf8'), /supervisor status/);
});

test('Windows standard relaunch falls back to the Explorer Shell object by executable path', () => {
  const relaunch = standardRelaunchBytes.toString('utf8');
  assert.match(relaunch, /shellWindows\.Windows\(\)/);
  assert.match(relaunch, /GetFileName\(\[string\]\$_.FullName\).*explorer\.exe/);
  assert.doesNotMatch(relaunch, /Get-Process\s+-Name\s+explorer/);
});

test('Windows watchdog only pauses for a live or recent update marker', () => {
  const watchdog = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'watchdog.js'), 'utf8');
  assert.match(watchdog, /updateProcessIsActive/);
  assert.match(watchdog, /apply-update\\\\\.ps1/);
  assert.match(watchdog, /gracePeriodMs\s*=\s*10 \* 60 \* 1000/);
  assert.match(watchdog, /unlinkSync\(UPDATE_PENDING_FILE\)/);
  assert.match(watchdog, /if \(updatePendingIsActive\(\)\)/);
});

test('Windows installer excludes the repair prompt from all release stages', () => {
  const zipBuild = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-win-zip.sh'), 'utf8');
  const installerBuild = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-win-installer.ps1'), 'utf8');
  const iss = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'win', 'workdaddy.iss'), 'utf8');
  assert.doesNotMatch(zipBuild, /cp\s+.*安装失败自主解决提示词/);
  assert.doesNotMatch(installerBuild, /Test-Path[\s\S]{0,160}安装失败自主解决提示词/);
  assert.doesNotMatch(iss, /Source:.*安装失败自主解决提示词/);
});

test('All-in-one package mode: staging skips branding and ships the supervisor', () => {
  const zipBuild = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-win-zip.sh'), 'utf8');
  const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-win-installer.ps1'), 'utf8');
  const iss = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'win', 'workdaddy.iss'), 'utf8');
  const install = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-win.ps1'), 'utf8');
  const uninstall = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'uninstall-win.ps1'), 'utf8');
  const prepare = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-win-install.ps1'), 'utf8');
  const verify = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-win.cmd'), 'utf8');
  // zip 脚本：all 模式独立命名，且不做默认 profile / ps1 占位符替换
  assert.match(zipBuild, /all\) PACKAGE_NAME="WorkSwitch-All"/);
  assert.match(zipBuild, /if profile != 'all':/);
  // installer：all 在 ValidateSet、命名与独立 AppId 里
  assert.match(installer, /'trae-work-cn', 'all'/);
  assert.match(installer, /\$Profile -eq 'all'\) \{ 'WorkSwitch All' \}/);
  assert.match(installer, /A31F6C42-58D2-4B07-9E44-6F83B25C71D8/);
  // iss：all 模式快捷方式指向 supervisor 隐藏启动器
  assert.match(iss, /#if ProfileId == "all"/);
  assert.match(iss, /supervisor-hidden\.vbs/);
  // install：all 分支注册管理器自启并清理旧分身自启项
  assert.match(install, /if \(\$Profile -eq 'all'\) \{/);
  assert.match(install, /WorkSwitchAll/);
  assert.match(install, /supervisor-hidden\.vbs/);
  // uninstall：all 分支停管理器与全部 profile 生命周期
  assert.match(uninstall, /supervisor\.pid/);
  // prepare：all 分支循环停止全部生命周期
  assert.match(prepare, /\$Profile -eq 'all'/);
  // 自检清单包含管理器文件
  assert.match(verify, /supervisor\.js supervisor-hidden\.vbs/);
  // 托盘脚本随 scripts 整体打入安装暂存包（cp -R scripts），且不被排除
  assert.match(zipBuild, /cp -R scripts "\$STAGE\/scripts"/);
  assert.doesNotMatch(zipBuild, /supervisor-tray\.ps1/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'supervisor-tray.ps1')), 'supervisor-tray.ps1 必须随 scripts 一起打包');
});
