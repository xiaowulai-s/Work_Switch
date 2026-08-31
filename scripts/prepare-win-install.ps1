param(
  [Parameter(Mandatory = $true)][string]$BoundaryPath,
  [Parameter(Mandatory = $true)][string]$AppDir,
  [ValidateSet('workbuddy-cn', 'workbuddy-ai', 'trae-work-cn', 'all')][string]$Profile = 'workbuddy-cn',
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $privilege = if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'elevated' } else { 'standard' }
} catch {
  [Console]::Error.WriteLine('Cannot determine the Windows privilege mode for the installer.')
  exit 5
}

if (-not (Test-Path -LiteralPath $AppDir -PathType Container)) { exit 0 }

$ErrorActionPreference = 'Stop'
$diagnosticFile = Join-Path ([IO.Path]::GetTempPath()) 'WorkDaddy-prepare-install.log'
try {
  [IO.File]::AppendAllText(
    $diagnosticFile,
    ('[' + [DateTime]::UtcNow.ToString('o') + '] start profile=' + $Profile + ' privilege=' + $privilege + ' appDir=' + $AppDir + [Environment]::NewLine),
    (New-Object Text.UTF8Encoding($false)))
  . $BoundaryPath
  $dataRoot = Join-Path $env:APPDATA 'WorkDaddy'
  # 方案 C：全端模式重装时，停掉本安装目录下全部 profile 的生命周期（标准权限下失败即中止）
  if ($Profile -eq 'all') {
    # 先精确停止运行中的管理器：管理器会把刚停掉的 daemon 立刻用 launcher 拉起，
    # 若不先停它，本方案的逐 profile 停止会和它赛跑，最后必在身份校验上 fail-closed。
    # 校验 supervisor.pid → 精确 node + 本安装目录 supervisor.js；无法确认则 fail-closed。
    $supervisorPidFile = Join-Path $dataRoot 'supervisor.pid'
    if (Test-Path -LiteralPath $supervisorPidFile) {
      $supPid = 0
      try { $supPid = [int](Get-Content -LiteralPath $supervisorPidFile -Raw).Trim() } catch {}
      if ($supPid -gt 0) {
        $supProc = Get-CimInstance Win32_Process -Filter "ProcessId = $supPid" -ErrorAction Stop
        if ($null -eq $supProc -or $supProc.Name -ine 'node.exe') { throw 'supervisor.pid 未指向可确认的 node 管理器进程' }
        $expectedSupervisor = Join-Path $AppDir 'scripts\supervisor.js'
        if ($supProc.CommandLine -match ([regex]::Escape($expectedSupervisor))) {
          Stop-Process -Id $supPid -Force
        } else {
          throw 'supervisor.pid 指向的进程与本安装目录的 supervisor.js 不符，拒绝停止'
        }
      }
      Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
    }
    $prepareTargets = @(
      @{ ProfileId = 'workbuddy-cn'; DataDir = $dataRoot; Port = 47832 },
      @{ ProfileId = 'workbuddy-ai'; DataDir = (Join-Path $dataRoot 'profiles\workbuddy-ai'); Port = 47833 },
      @{ ProfileId = 'codebuddy-cn'; DataDir = (Join-Path $dataRoot 'profiles\codebuddy-cn'); Port = 47834 },
      @{ ProfileId = 'codebuddy-intl'; DataDir = (Join-Path $dataRoot 'profiles\codebuddy-intl'); Port = 47835 },
      @{ ProfileId = 'trae-work-cn'; DataDir = (Join-Path $dataRoot 'profiles\trae-work-cn'); Port = 47836 }
    )
    foreach ($t in $prepareTargets) {
      $dataDir = $t.DataDir
      $uiPort = $t.Port
      $currentProfile = $t.ProfileId
      Stop-VerifiedWorkDaddyLifecycle `
        -DataDir $t.DataDir `
        -Port $t.Port `
        -ExpectedProfile $t.ProfileId `
        -ExpectedWatchdogScript (Join-Path $AppDir 'scripts\watchdog.js') `
        -ExpectedDaemonScript (Join-Path $AppDir 'scripts\daemon.js') | Out-Null
    }
    exit 0
  }
  $dataDir = if ($Profile -eq 'workbuddy-ai') { Join-Path $dataRoot 'profiles\workbuddy-ai' } elseif ($Profile -eq 'trae-work-cn') { Join-Path $dataRoot 'profiles\trae-work-cn' } else { $dataRoot }
  $currentProfile = $Profile
  $uiPort = if ($Profile -eq 'workbuddy-ai') { 47833 } elseif ($Profile -eq 'trae-work-cn') { 47836 } else { 47832 }
  Stop-VerifiedWorkDaddyLifecycle `
    -DataDir $dataDir `
    -Port $uiPort `
    -ExpectedProfile $Profile `
    -ExpectedWatchdogScript (Join-Path $AppDir 'scripts\watchdog.js') `
    -ExpectedDaemonScript (Join-Path $AppDir 'scripts\daemon.js')
  exit 0
} catch {
  $stopError = $_.Exception.Message
  $profileForAuth = if ($Profile -eq 'all') { $currentProfile } else { $Profile }
  if ($privilege -eq 'standard') {
    try {
      [void](Get-AuthenticatedWorkDaddyStatus `
        -DataDir $dataDir `
        -Port $uiPort `
        -ExpectedProfile $profileForAuth `
        -ExpectedVersion $ExpectedVersion `
        -AllowVersionMismatch)
      [IO.File]::AppendAllText(
        $diagnosticFile,
        ('[' + [DateTime]::UtcNow.ToString('o') + '] preserved authenticated elevated lifecycle profile=' + $profileForAuth +
          ' expectedVersion=' + $ExpectedVersion + [Environment]::NewLine),
        (New-Object Text.UTF8Encoding($false)))
      # Inno treats 10 as a verified compatibility path and skips only the
      # locked bundled runtime. No cross-integrity termination is attempted.
      exit 10
    } catch {
      $capabilityError = $_.Exception.Message
    }
  }
  try {
    [IO.File]::AppendAllText(
      $diagnosticFile,
      ('[' + [DateTime]::UtcNow.ToString('o') + '] failed profile=' + $Profile + ' error=' + $stopError +
        $(if ($capabilityError) { ' capability=' + $capabilityError } else { '' }) + [Environment]::NewLine),
      (New-Object Text.UTF8Encoding($false)))
  } catch {}
  [Console]::Error.WriteLine('Cannot safely stop the existing WorkDaddy lifecycle: ' + $stopError)
  exit 2
}
