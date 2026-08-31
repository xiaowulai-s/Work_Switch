#requires -Version 5.1
# WorkSwitch 系统托盘宿主（Windows）
#
# 职责（只做两件事）：
#   1. 常驻触发入口：每个受监管 profile 一个菜单项，点击即把「打开该客户端」的意图交给
#      常驻 supervisor（`open <profile>`），由它去重后调用 win-launcher 拉起/补齐。
#   2. 状态展示：打开菜单时调用 `supervisor status` 取三态快照（运行中/待补齐/未知/未运行）。
#
# 边界：托盘只「打开」，不提供退出、不强杀、不做任何跨 profile 进程操作，与 supervisor
# 「只补齐不杀伤」原则一致。升级运营状态（如配额/提权）一律 fail-closed 交给 launcher。
#
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File supervisor-tray.ps1 -NodePath <node.exe> -SupervisorPath <supervisor.js>
param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$SupervisorPath
)
$ErrorActionPreference = 'Stop'

$node = [IO.Path]::GetFullPath($NodePath)
$supervisor = [IO.Path]::GetFullPath($SupervisorPath)
$scriptsRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Node runtime is missing.' }
if (-not (Test-Path -LiteralPath $supervisor -PathType Leaf)) { throw 'Supervisor script is missing.' }
if (-not $supervisor.StartsWith($scriptsRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Supervisor script is outside the installed scripts directory.'
}

# 单实例：同一用户的托盘只允许一份，避免叠加出多个图标。
$script:trayPidFile = Join-Path ([IO.Path]::Combine([Environment]::GetFolderPath('ApplicationData'), 'WorkDaddy')) 'supervisor-tray.pid'
function Test-TrayAlreadyRunning {
  try {
    $pid0 = [int](Get-Content -LiteralPath $script:trayPidFile -ErrorAction Stop)
    $proc = Get-Process -Id $pid0 -ErrorAction Stop
    return $proc -and $proc.ProcessName -like '*powershell*'
  } catch { return $false }
}
function Write-TrayPid { try { Set-Content -LiteralPath $script:trayPidFile -Value ([string]$PID) -Encoding UTF8 -ErrorAction Stop } catch {} }
if (Test-TrayAlreadyRunning) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Invoke-SupervisorStatus {
  try {
    $raw = (& $node $supervisor status 2>$null) -join "`n"
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ($raw | ConvertFrom-Json)
  } catch { return $null }
}

function Format-StatusLabel {
  param([string]$Status)
  switch ($Status) {
    'normal'    { return '● 运行中' }
    'pending'   { return '▲ 待补齐' }
    'unknown'   { return '? 未知' }
    default     { return '○ 未运行' }
  }
}

# 每次打开菜单时刷新：取 supervisor 三态快照重建菜单项。
function Update-TrayMenu {
  param($Context)
  $Context.Items.Clear()
  $status = Invoke-SupervisorStatus
  if (-not $status -or -not $status.ok) {
    $item = New-Object System.Windows.Forms.ToolStripMenuItem('WorkSwitch 管理器未就绪')
    $item.Enabled = $false
    [void]$Context.Items.Add($item)
  } else {
    foreach ($prop in $status.profiles.PSObject.Properties) {
      $row = $prop.Value
      $label = '{0}   {1}' -f (Format-StatusLabel $row.status), $row.name
      $item = New-Object System.Windows.Forms.ToolStripMenuItem($label)
      $item.Tag = $prop.Name
      # 点击 → 把 open 意图交给常驻 supervisor（并入其去重，不直连 launcher）。
      $item.Add_Click({
        param($sender, $evt)
        $id = [string]$sender.Tag
        $argStr = ('"{0}" open {1}' -f $supervisor.Replace('"', '\"'), $id)
        try {
          Start-Process -FilePath $node -ArgumentList $argStr -WindowStyle Hidden -ErrorAction Stop
        } catch { }
      })
      [void]$Context.Items.Add($item)
    }
  }
  [void]$Context.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
  $quit = New-Object System.Windows.Forms.ToolStripMenuItem('退出托盘（不影响已打开客户端）')
  $quit.Add_Click({ param($sender, $evt) [System.Windows.Forms.Application]::Exit() })
  [void]$Context.Items.Add($quit)
}

$icon = New-Object System.Drawing.Icon([System.Drawing.SystemIcons]::Application, 32, 32)
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = 'WorkSwitch 客户端管理器'
$notify.Visible = $true
$context = New-Object System.Windows.Forms.ContextMenuStrip
$notify.ContextMenuStrip = $context
$context.add_Opening({ param($sender, $evt) Update-TrayMenu $sender })
[System.Windows.Forms.Application]::add_ApplicationExit({
  param($sender, $evt)
  try { $notify.Visible = $false; $notify.Dispose(); $icon.Dispose() } catch { }
  try { Remove-Item -LiteralPath $script:trayPidFile -ErrorAction SilentlyContinue } catch { }
})

Write-TrayPid
# 进入 WinForms 消息循环，常驻直到退出项被点击。
[System.Windows.Forms.Application]::Run()