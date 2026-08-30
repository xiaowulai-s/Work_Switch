# WorkDaddy Windows 卸载脚本（uninstall.sh 的 Windows 对应物）
# 用法：powershell -ExecutionPolicy Bypass -File uninstall-win.ps1
# 默认保留备份数据（%APPDATA%\WorkDaddy）；加 -RemoveData 一并删除。
param(
  [switch]$RemoveData,
  [switch]$SkipAppRemoval,
  [string]$AppDir = '',
  [string]$Profile = '__WBS_DEFAULT_PROFILE__'
)

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $env:WBSWITCH_PRIVILEGE_MODE = if ($isElevated) { 'elevated' } else { 'standard' }
} catch {
  [Console]::Error.WriteLine('无法确认当前 PowerShell 的 Windows 权限模式；卸载已停止。')
  exit 5
}

$ErrorActionPreference = 'Stop'
try { . (Join-Path $PSScriptRoot 'windows-process-boundary.ps1') } catch {
  [Console]::Error.WriteLine('无法加载 Windows 进程身份边界；卸载已停止。')
  exit 5
}
$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($Profile) -or $Profile -eq '__WBS_DEFAULT_PROFILE__') { $Profile = 'workbuddy-cn' }
if ($Profile -ne 'workbuddy-ai' -and $Profile -ne 'trae-work-cn' -and $Profile -ne 'all') { $Profile = 'workbuddy-cn' }
$productName = if ($Profile -eq 'workbuddy-ai') { 'WorkSwitch AI' } elseif ($Profile -eq 'trae-work-cn') { 'WorkSwitch Trae' } elseif ($Profile -eq 'all') { 'WorkSwitch All' } else { 'WorkSwitch' }
if ([string]::IsNullOrWhiteSpace($AppDir)) { $AppDir = Join-Path $env:LOCALAPPDATA (Join-Path 'Programs' $productName) }
if (-not (Test-SameWindowsPath -Left $PSScriptRoot -Right (Join-Path $AppDir 'scripts'))) {
  throw '卸载脚本位置与目标安装目录不一致，拒绝删除'
}
$dataRoot = Join-Path $env:APPDATA 'WorkDaddy'
$dataDir = if ($Profile -eq 'workbuddy-ai') { Join-Path $dataRoot 'profiles\workbuddy-ai' } elseif ($Profile -eq 'trae-work-cn') { Join-Path $dataRoot 'profiles\trae-work-cn' } else { $dataRoot }
$port = if ($Profile -eq 'workbuddy-ai') { 47833 } elseif ($Profile -eq 'trae-work-cn') { 47836 } else { 47832 }

Write-Host ('卸载 ' + $productName + '...')

# 0) 全端模式：先停管理器，再停本安装目录下的全部 profile 生命周期
if ($Profile -eq 'all') {
  $supervisorPidFile = Join-Path $dataRoot 'supervisor.pid'
  try {
    if (Test-Path $supervisorPidFile) {
      $supPid = [int](Get-Content -LiteralPath $supervisorPidFile -Raw).Trim()
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $supPid" -ErrorAction SilentlyContinue
      if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'supervisor\.js') {
        Stop-Process -Id $supPid -Force
        Write-Host '  已停止 WorkSwitch 管理器'
      }
      Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  foreach ($p in @(
    @{ DataDir = $dataRoot; Port = 47832 },
    @{ DataDir = (Join-Path $dataRoot 'profiles\workbuddy-ai'); Port = 47833 },
    @{ DataDir = (Join-Path $dataRoot 'profiles\codebuddy-cn'); Port = 47834 },
    @{ DataDir = (Join-Path $dataRoot 'profiles\codebuddy-intl'); Port = 47835 },
    @{ DataDir = (Join-Path $dataRoot 'profiles\trae-work-cn'); Port = 47836 }
  )) {
    try {
      Stop-VerifiedWorkDaddyLifecycle `
        -DataDir $p.DataDir `
        -Port $p.Port `
        -ExpectedWatchdogScript (Join-Path $AppDir 'scripts\watchdog.js') `
        -ExpectedDaemonScript (Join-Path $AppDir 'scripts\daemon.js')
      Write-Host ('  已停止 profile 生命周期: ' + $p.Port)
    } catch {
      Write-Host ('  提示: ' + $p.Port + ' 无匹配生命周期或停止失败（忽略）: ' + $_.Exception.Message)
    }
  }
}

# 1) 只有在 watchdog/daemon 身份确认或明确不存在后才允许任何卸载写操作。
if ($Profile -ne 'all') {
  Stop-VerifiedWorkDaddyLifecycle `
    -DataDir $dataDir `
    -Port $port `
    -ExpectedWatchdogScript (Join-Path $AppDir 'scripts\watchdog.js') `
    -ExpectedDaemonScript (Join-Path $AppDir 'scripts\daemon.js')
}

# 2) 移除登录自启（兼容 WorkDaddy / WorkDaddy AI / WorkDaddy Trae 三个 profile）
try {
  foreach ($runName in @('WorkSwitch', 'WorkSwitch AI', 'WorkSwitch Trae', 'WorkDaddy', 'WorkDaddy AI', 'WorkDaddy Trae', 'WorkSwitchAll')) {
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $runName -ErrorAction SilentlyContinue
  }
  Write-Host '  已移除登录自启项'
} catch {}

# 3) 删除安装目录（Inno Setup 调用时由卸载器负责删除）
if (-not $SkipAppRemoval -and (Test-Path $AppDir)) {
  Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction Stop
  if (Test-Path -LiteralPath $AppDir) { throw "安装目录删除失败: $AppDir" }
  Write-Host ('  已删除安装目录: ' + $AppDir)
} elseif ($SkipAppRemoval) {
  Write-Host '  已停止 WorkDaddy 生命周期，安装器将继续删除程序文件'
}

# 4) 数据目录（可选）
if ($RemoveData) {
  if (Test-Path $dataDir) {
    Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $dataDir) { throw "数据目录删除失败: $dataDir" }
    Write-Host ('  已删除数据目录（含账号备份）: ' + $dataDir)
  }
} else {
  Write-Host ('  已保留备份数据（含账号备份）: ' + $dataDir)
}

Write-Host '卸载完成。'
if (-not $RemoveData) {
  Write-Host '如需同时删除账号备份，请重新运行：uninstall-win.ps1 -RemoveData'
}
