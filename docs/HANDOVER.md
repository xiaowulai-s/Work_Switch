# WorkSwitch 交接文档

> 更新时间：2026-08-30 · 当前版本：**v0.3.2**（Setup.exe 已生成 `WorkSwitch-All-Setup-0.3.2.exe`，待正式发布/交接；本机安装因残留守护进程被后台阻止未完）· README.md 已同步全端形态
> 本次（0.3.2）三处新增/修复：① 多客户端**系统托盘宿主**（`supervisor-tray.ps1`）+ supervisor `open`/`status` 子命令 + 跨进程「打开意图」队列 + supervisor 守护托盘；② **CodeBuddy CN 实机修复**：`codebuddy cn.exe` 镜像名白名单/命名曾在进程边界层漏配，已统一并实机验证插件注入成功；③ 打包链 `build-win-release.ps1` all 包名映射漏 `all` 分支已修复。详见下。
> 本文档面向接手开发者：先读「项目概览」与「开发环境」，再按模块索引查细节。
> 工作区规范（不可违背的原则、打包 Runbook、验证命令）以根目录 `AGENTS.md` 为准，本文不重复。

## 1. 项目概览

WorkSwitch（fork 自 WorkDaddy）是 AI 桌面客户端的本地增强层：通过 Chrome DevTools Protocol（CDP）向正在运行的 Electron 客户端注入一个面板，本地 daemon 提供账号备份/切换、会话管理、防休眠、在线模型切换等能力。**零侵入、只走 CDP 和本地文件，不改官方 app.asar，daemon 只绑 127.0.0.1。**

**发布形态（v0.3.0 起）**：全端单包 `WorkSwitch-All-Setup-x.y.z.exe`——一次安装承载全部客户端。安装后注册常驻 **supervisor**（`scripts/supervisor.js`，登录自启），它轮询检测哪个受支持客户端在运行，按需为该 profile 拉起 daemon+注入；**运行时仍是每客户端一个独立 daemon 实例**（由 `--profile=<id>` 命令行参数绑定，优先于 `WBSWITCH_PROFILE` 环境变量），端口/数据目录/进程边界与分身时代完全一致。

支持的 5 个客户端：

| profile | 客户端 | kind | UI 端口 | CDP 端口 | 已开放能力 |
|---|---|---|---|---|---|
| `workbuddy-cn` | WorkBuddy 国内版 | workbuddy | 47832 | 9222 | 全部（账号/会话/模型/暂存/主题/签到） |
| `workbuddy-ai` | WorkBuddy AI 国际版 | workbuddy | 47833 | 9223 | 全部（签到除外） |
| `codebuddy-cn` | CodeBuddy 国内版 | codebuddy | 47834 | 9224 | 会话只读 + 签到 |
| `codebuddy-intl` | CodeBuddy 国际版 | codebuddy | 47835 | 9225 | 会话只读 + 签到 |
| `trae-work-cn` | Trae Work CN（字节 TraeWork） | trae | 47836 | 9240 | 会话只读 + **在线模型列表/切换** + 会话重命名/删除（见 §3.7） |

内部约定（勿改，多处依赖）：API 协议头 `X-WorkDaddy-Token`；数据目录 `%APPDATA%\WorkDaddy`（非 CN profile 在其下 `profiles\<id>` 子目录）；注入占位符 `__WBS_*` 系列；`WBS_` 前缀的内部标识；**watchdog/daemon 进程命令行必须携带 `--profile=<id>`（多 profile 进程身份的唯一区分点，见 §3.9）**。

## 2. 发布历史与当前状态

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.0.1 | 2026-08-30 | WorkSwitch 品牌化首发；Trae 全链路接入（只读会话）；渠道声明制。CI 两处环境差异坑修复后重发（见 §3.5）。 |
| v0.1.0 | 2026-08-30 | Trae 在线模型列表/切换 + 会话重命名/删除（`__wbsTraeModels`/`__wbsTraeSessionOps`，走官方 UI 入口，不触云 API）；daemon 增 4 条 `/api/trae/*` 路由。 |
| v0.2.0 | 2026-08-30 | **方案 C 落地**：supervisor 多客户端管理器 + 多 profile 进程身份修复（`--profile` 命令行身份）+ 打包链 all 模式；真机安装冒烟通过。曾发布 4 个安装包（三分身 + All）。 |
| v0.3.0 | 2026-08-30 | **发布物收敛**：只发 `WorkSwitch-All-Setup-*`，分身安装包下架（CI/打包循环只跑 all）；更新渠道收敛（CN/AI → All 资产）；launcher 优雅关闭失败不再中断（交给强杀轮）。 |
| v0.3.2 | 2026-08-30 | **多客户端托盘宿主 + CodeBuddy CN 实机修复 + 打包命名修复**：新增常驻系统托盘入口（`supervisor-tray.ps1`，随 supervisor 守护拉起），托盘列出各客户端实时三态状态并可将「打开」意图交给 supervisor；supervisor 增 `open <profile>`/`status` 子命令与跨进程意图队列（命令文件并入单例拉起去重）；`codebuddy cn.exe` 补入进程边界层白名单（此前漏配导致 launcher 找到 exe 却在重启前验证失败）；`build-win-release.ps1` 修复 all 包名映射（漏 `all` 分支会误找 `WorkSwitch-Setup-*`）。Setup.exe 已生成、未发布。 |

**升级路径说明（写发版说明时必须带上）**：
- 旧 CN 分身（0.1.0/0.2.0）：自身旧代码的兜底正则可匹配 `WorkSwitch-All-Setup-*` → **自动升级**到全端版（安装器精确停旧生命周期）。
- 旧 AI 分身：旧正则锁死 `WorkSwitch-AI-` 前缀，匹配不到新资产 → **需手动安装一次全端版**。
- 旧 Trae 分身 / 手动安装：无渠道，手动安装。
- 静默安装（`/SILENT`+）会跳过 iss 的 postinstall（`skipifsilent`），装完需手动执行一次 `install-win.ps1 -Profile all` 完成自启注册。

**本机生产状态（2026-08-30）**：安装版 WorkSwitch All（`%LOCALAPPDATA%\Programs\WorkSwitch All`）托管 Trae 与 WorkBuddy，登录自启已注册。`E:\Demo\WorkSwitch` 仅作开发。**此处重要**：v0.3.2 的 Setup.exe 已在本机用本地 Git Bash + Inno Setup 6 编译生成，但**本机安装（覆盖升级到 0.3.2）被后台进程阻止未完**——原因是安装器预检 `prepare-win-install.ps1` 在标准权限下遇到「Node 入口脚本不匹配/DataDir 为空」及疑似 elevated 的旧版守护进程即 fail-closed 中止（符合 AGENTS 的提权 fail-closed 原则），且安装版 watchdog 存在**自愈循环**（逐个 stop 后约 6s 自动复活，Run/计划任务/启动文件夹均无自启项，来源是其自保逻辑）。**接手者如需完成本机升级，按安装包提示操作：先完全退出 WorkSwitch All 的 daemon/watchdog/tray 全部生命周期，仍不行则右键以管理员身份运行 `WorkSwitch-All-Setup-0.3.2.exe` 一次完成迁移**。代码侧修复（托盘/白名单/包名）已全量落地并有测试护栏，与是否完成本机安装无关。

## 3. 模块实现细节（含关键设计决策与坑）

### 3.1 profile 注册与端口

- `scripts/profiles.js`：唯一注册点。每个 profile 声明 appPath/dataRoot/authFile/sessionDb/modelsFile/apiHost/capabilities/targetHints/appName。未知 profile 直接抛错（fail-closed）。
- UI 端口：`scripts/ui-port.js` `PROFILE_UI_PORTS`（主端口 + 17xxx/27xxx/37xxx 回退段）；CDP 端口：`daemon.js` 与 `win-launcher.js` 各有一份 `PROFILE_CDP_PORTS`。**注意**：workbuddy-cn 的 CDP 回退段占 9226-9232、workbuddy-ai 占 9233-9239，**新 trae 系客户端从 9240 起分配**（trae-work-cn=9240）。`ui-port.js` 对未知 profile 会静默回落 47832——加新 profile 时必须同步端口表并更新 `test/ui-port.test.js` 的互斥断言。
- `appPath` Windows 安装路径不一定真实存在（自定义安装），win-launcher 有注册表/盘根兜底（见 §3.6）。

### 3.2 CDP target 归属判定（`scripts/cdp-targets.js`，纯函数）

- `classifyTarget`：强信号 = app 包路径 / 登录域名。Trae Work CN 的强信号正则 `APP_TRAE_WORK_CN = /\/TRAE SOLO CN(?:\.app)?(?:\/|$)/i`（Windows 的 vscode-file URL 归一化后含安装目录；macOS 包名 `/Applications/TraeWork CN.app` 为预留值，**实机未验证**）。
- `isTargetForProfile`：强信号命中即严格比对 profile id；无强信号时 kind 宽松兜底（codebuddy/trae 要求 URL 以 vscode-file 开头或 haystack 含产品名；trae 额外要求 /trae/i 或 vscode-file，防误连）。改动这里必须同步 `test/cdp-targets.test.js`。

### 3.3 daemon（`scripts/daemon.js`，34 万字符大文件）

- **profile 解析顺序**：`--profile=` argv → `WBSWITCH_PROFILE` env → `workbuddy-cn`（方案 C 起支持 argv）。
- **会话层分 kind**：`sqliteRun`（写）只允许 kind=workbuddy；`sqliteQuery`（读）三路：workbuddy 直读 SQLite、codebuddy 走 `codeBuddySessionRows()`（明文 vscdb）+ SQL 形状过滤、trae 走 `traeSessionRows()`（CDP 读渲染层收集器）+ `filterTraeSessionRows()`（主列表/DISTINCT cwd 两种 SQL 形状 + uid/时间过滤）。
- **注入时占位符替换**（`injectWidget` 内）：`__WBS_PROFILE__`、`__WBS_PROFILE_KIND__`、`__WBS_CAPS__`、`__WBS_API_TOKEN__` 等。inject.js **每次注入都重新读文件**——改 inject.js 不用重启 daemon，调 `POST /api/inject`（带 token）即可；改 daemon.js 需重启（watchdog 检测版本不一致会自动重启，开发时直接 kill daemon 即可）。
- **CORS 白名单**：`isAllowedApiOrigin` 必须包含 `vscode-file://` 前缀（CodeBuddy/Trae workbench 的 Origin），否则面板所有 fetch 静默失败（`net::ERR_FAILED`，无日志痕迹）。Trae 接入时踩的最大坑。
- **更新渠道（v0.3.0 收敛后）**：workbuddy-cn/ai → `'WorkSwitch-All-'`，codebuddy/trae → null（完全不触达 Releases API）。资产正则统一为 `WorkSwitch-All-Setup-*` / `WorkSwitch-All-*-win64.zip`。历史包袱说明：旧 CN 分身靠自身旧代码的兜底正则升级到全端版；旧 AI 分身的正则锁死旧前缀，升级需手动。`test/update-channel.test.js` 是护栏。
- cdpSend **返回值已剥一层**：取值用 `r.result.value`（不是 `r.result.result.value`）——traeSessionRows 曾因此静默返回空列表。异步收集器（模型/会话操作）需 `awaitPromise: true`。

### 3.4 inject.js（注入面板，52 万字符）

- 顶部（`__wbsWidget` 守卫**之前**）按 kind 安装收集器，重注入整段覆盖：
  - `__wbsTraeSessions`：沿 DOM 元素 `__reactFiber$` 键向上走 ≤14 层 return，收集 `props.group`（id/children/name）的 fiber → 会话行。**为什么走渲染层**：Trae 本地会话库是加密 SQLite，云端列表接口只在页面加载拉一次且带 Cloud-IDE-JWT；侧栏 fiber 是唯一稳定源。`hasMoreSessions=false`（当前视图全量加载），侧栏按工作区过滤视图，收集器只反映当前视图——固有语义。
  - `__wbsTraeModels` / `__wbsTraeSessionOps`：见 §3.7。
- CAPS 门控：accounts/models/theme/stashPrompt/sessions 各自控制 tab 增删。**易错点**：① `!CAPS.accounts` 分支有默认激活 tab 回退；② `logoutBtn` 只在账号 pane 存在时非空，挂监听必须判空——曾因未判空导致 build() 中途抛错、连锁使 `ND_DEFS` undefined（增强页崩溃）。
- daemon 侧注入 `__WBS_PROFILE_KIND__`（workbuddy/codebuddy/trae），kind 专属 UI 逻辑用它门控，别堆 PROFILE_ID 前缀判断。
- 面板 fetch 从 vscode-file origin 发出，依赖 §3.3 的 CORS 白名单。

### 3.5 安装与打包链（Windows）

- 链路：`build-win-release.ps1`（只跑 all）→ `build-win-zip.sh`（暂存 ZIP + 打包期替换）→ `build-win-installer.ps1`（Inno Setup 编 `WorkSwitch-All-Setup-*.exe`，`scripts/win/workdaddy.iss` 全参数驱动）。
- **all 模式**：不做 win-launcher 默认 profile 替换（保留 `|| 'workbuddy-cn'` 字面量——supervisor 以环境变量显式指定，手动运行 launcher 回落 CN 是文档化行为）；不做 ps1 占位符替换（iss 显式传 `-Profile all`，ps1 内部自带 all 分支）；快捷方式指向 `supervisor-hidden.vbs`（无桌面图标）。**v0.3.2 修复打包脚本 `build-win-release.ps1` 的安装包名映射**：`$packageName` 映射曾漏 `all` 分支——leaks 到 else `'WorkSwitch'`，导致编译出的实际物 `WorkSwitch-All-Setup-<ver>.exe` 与脚本校验查找的 `WorkSwitch-Setup-<ver>.exe` 不符、误报「未找到生成的安装包」（`test/windows-release-script.test.js` 有 `$Profile -eq 'all' → 'WorkSwitch-All'` 回归护栏）。
- **分身模式遗留**（代码保留，发布不再产出）：AI/Trae 品牌化块按「基准串 → 变体串」替换——改基准文案必须同步 zip 脚本的新旧串对；ps1 只替换 param 默认值占位符，**绝不能全局替换**。
- daemon 版本一致性：zip 打包期强制重写 staged daemon.js 的 `DAEMON_VERSION`/`DAEMON_BUILD_ID`——**tag 发布时 CI 用的是源码里的版本号，改版本要改源码**。
- CI 历史坑（两处环境差异，修复有回归测试）：① Git Bash 的 GNU grep 读文本剥 CR → CRLF 校验必须用 `tr` 字节统计；② Windows CI 的 Python 3.12 管道 stdout 默认 cp1252 → zip 脚本 `export PYTHONUTF8=1` + 品牌化块内 `sys.stdout.reconfigure`。教训：写 CI 逻辑前先确认 runner 环境默认值。

### 3.6 Windows 启动器（`win-launcher.js`）

- 每类 profile 有 `PROFILE_PROCESS_NAMES`/`PROFILE_BINARY_NAMES`（精确镜像名小写），进程查询/退出判定只认自己的镜像，绝不全名杀伤。
- exe 发现顺序：PROFILE.appPath → App Paths 注册表 → 卸载注册表（Trae 用 `TraeWork|TRAE SOLO`，**不能匹配裸 "Trae"**）→ 常见路径 → 盘根候选 → PowerShell 扫描；`selectPreferredDiscoveredBinary` 按镜像名兜底过滤。
- **关闭流程**：优雅轮（无 /F，容忍失败记日志继续）→ `waitForWorkBuddyExit` → 两轮强杀（/F，逐个复验身份，失败仍 fail-closed）。**背景**：WorkBuddy 的 GUI 子进程不处理 WM_CLOSE，优雅 taskkill 常失败——曾因优雅轮立即抛错导致客户端死在半路（v0.2.0 修复）。
- 进程身份判定：`uniqueNodeProcess`/`assertVerifiedNodeProcess` 均按 `PROFILE.id` 收窄（命令行 `--profile=` 尾参严格匹配），多 profile 同目录时互不误认。

### 3.7 Trae 在线模型 + 会话操作（kind=trae 专属）

- **模型数据源**：服务端下发（state.vscdb 的 `AI.agent.model.model_list_map` 只是缓存，运行时持锁不可直写）。权威数据在 composer 的 `core-model-select` 下拉：`[role="option"]` + 非 option 的 `.core-model-select-auto-mode-item`（Auto Mode，`active` 类=生效）+ `.core-model-select-model-group-label`（分组头）。
- **收集器**（`__wbsTraeModels` / `__wbsTraeSessionOps`，kind=trae，widget 守卫之前）：返回 `Promise<string(JSON)>`，daemon 侧用 `Runtime.evaluate awaitPromise:true` 取值。操作方式 = 派发与用户一致的指针事件后立即恢复原状，无监听器/无 observer。
- **三个必须踩对的点**（实测踩过）：
  1. **PointerEvent 必须带 `pointerType: 'mouse'`**——Radix 校验，缺省 `''` 不触发。
  2. **下拉刚展开时选择处理器未挂载**，立即点击无效——用「触发后下拉自行收起=成功」信号重试（≤3×800ms）。
  3. **受限模型与普通模型渲染路径不同**：受限项 fiber 链上有 `item`/`onItemClick` prop，普通项没有——模型名必须从 `.core-model-select-model-item-name` DOM 读。
- **会话操作**（`__wbsTraeSessionOps`）：重命名驱动侧栏「更多」菜单（`taskMoreB` → `.task-list-menu` → 重命名 → 行内 `textarea.task-list-rename-input` → React 原生 setter + Enter）；删除驱动「删除任务」→ Trae 自带确认弹窗（`.dialog-` 前缀类，无 role=dialog）→ 点文案恰为「删除」的按钮。安全约束：同名会话 >1 或不在当前侧栏视图一律拒绝；面板确认弹窗 + Trae 确认弹窗双重确认。**真实删除未在用户数据上执行**（无法安全构造一次性会话），弹窗出现/取消已实机验证。
- **API**：`GET /api/trae/models`、`POST /api/trae/models/switch {key}`（`__auto__`=Auto）、`POST /api/trae/sessions/rename {title,newTitle}`、`POST /api/trae/sessions/delete {title}`；仅 kind=trae，鉴权走 handleApi 全局门。
- **测试工具链坑**：Windows Git Bash 下 `curl -d` 发中文 JSON 会因代码页搞坏 UTF-8 载荷（症状：API 假性「未找到」）——带中文的接口测试必须用 python/文件体发送。
- **测试**：`test/trae-models.test.js`（静态护栏）。运行时行为只在 Trae 实机验证过。

### 3.9 supervisor 多客户端管理器（方案 C 核心，`scripts/supervisor.js`）

- **职责（只做三件事）**：轮询（10s）检测各 profile 客户端运行（精确镜像名）→ daemon/CDP 主端口不可用时调用 win-launcher 补齐（launcher 幂等）→ 客户端未运行不做任何事（daemon 拉起即常驻，与分身版语义一致）。客户端退出后不停 daemon。
- **CodeBuddy 双版共用 `codebuddy.exe` 镜像名**：仅当其 CDP 主端口（9224/9225）可响应（可判别版本）时才管理；普通方式启动时保持沉默（宁缺勿错）。**v0.3.2：CodeBuddy CN 1.106+ 镜像名实为 `codebuddy cn.exe`，supervisor/daemon/win-launcher 的 `PROFILE_PROCESS_NAMES`/`PROFILE_BINARY_NAMES`/`CLIENT_IMAGE_NAMES` 已统一改为此名**（intl 保留 `codebuddy.exe`），并且**进程边界层白名单 `windows-process-boundary.js` 的 `ALLOWED_WORKBUDDY_PROCESS_NAMES` 必须加入 `'codebuddy cn.exe'`**——漏加会在 launcher 找到 exe 后、重启前验证抛 "Expected executable is not a WorkBuddy-family binary"（v0.3.2 实机踩过并修复）。
- 单实例锁 `%APPDATA%\WorkDaddy\supervisor.pid`；`node supervisor.js stop` 停自身（不动 daemon）。在途锁（240s）+ 失败指数退避（30s→10min）。
- **多 profile 进程身份（关键约定）**：watchdog/daemon 命令行携带 `--profile=<id>`；`windows-process-boundary.js` 的 `filterVerifiedNodeProcesses`/`assertVerifiedNodeProcess` 新增 `expectedProfileId` 参数——命令行必须以 `--profile=<期望值>` 收尾（不带该参数调用 = 旧版严格行为，脚本后不得有任何参数）。**背景**：同目录多 profile 的 (node, 脚本) 身份完全相同，修复前 watchdog 互相「恢复 pid 文件」导致 daemon 起不来（实机复现）。新增按 profile 的进程判定时必须穿这个参数。
- **v0.3.2 新增常驻入口与意图队列（托盘宿主）**：
  - **`node supervisor.js open <profileId>`**（托盘/CLI 调）：把「打开某客户端」意图写入 `%APPDATA%\WorkDaddy\commands\open.<id>.<ts>.json` 命令文件后即返回 `{ok,accepted}`。常驻 supervisor 在每次轮询前 `drainOpenIntents()` 消费，置入对应 profile 单例状态的 `forceOpen`，真正拉起仍走其幂等 launcher——**尊重 LAUNCH_INFLIGHT(240s) 去重与退避，避免托盘与 supervisor 双路 launcher 抢占同一进程树**。已运行客户端点 open 只走补齐、不重复拉起；未运行则冷启动一次（带调试端口）。
  - **`node supervisor.js status`**：输出三态快照 JSON `{ok, profiles:{<id>:{name,running,status,daemon,cdp,inflight}}}`，`status ∈ normal|pending|unknown|not_running`。CodeBuddy 双版共用镜像名且无 CDP 时标 `unknown`（宁缺勿错，不冒充确定状态）。
  - **`supervisor-tray.ps1`（系统中鼠标常驻托盘宿主）**：只做「打开入口 + 状态展示」——每个受监管 profile 一个菜单项（点击即 `open` 交给 supervisor），打开菜单时用 `status` 刷新实时状态；提供「退出托盘（不影响已打开客户端）」，不做杀死/提权/跨 profile 操作（与 supervisor「只补齐不杀伤」一致）。托盘写入自己的 PID（`supervisor-tray.pid`），**supervisor 主循环 `ensureTrayRunning()` 守护它**：托盘崩溃/被误关后按 `TRAY_RESPAWN_COOLDOWN_MS`(60s) 自动补拉起，liveness 以托盘自报 PID 精确判定（不做宽名匹配）。
  - **坑（Windows PowerShell 5.1 编码）**：`supervisor-tray.ps1` 含中文菜单文案，**必须保存为 UTF-8 with BOM**；无 BOM 时 PS5.1 按系统代码页（GBK）解析导致 ParserError，托盘启动即崩、PID 文件不写、图标不显示（v0.3.2 实测修复，`test/windows-release-script.test.js` 有 BOM 回归护栏）。
- 真机验证：杀全部 Trae 生命周期 → supervisor 一个轮询周期重建（客户端零扰动）；WorkBuddy 普通启动 → 自动 CDP 重启 + 注入；安装版（bundled node）与 dev 目录并行验证过。v0.3.2 另真机验证：托盘点击 `open codebuddy-cn` → 冷启动 CodeBuddy CN 带 9224 调试端口 → CDP 注入成功，supervisor 状态转 normal。（注：托盘图标为 GUI 元素，需人工在系统托盘确认；菜单数据源即 `status` 命令。）

### 3.8 安装后脚本 all 分支（`install-win.ps1` / `uninstall-win.ps1` / `prepare-win-install.ps1`）

- **install all**：枚举旧分身安装目录（Programs\WorkSwitch[ AI| Trae]）精确停旧生命周期（迁移）→ robocopy 前先释放 launcher.cmd 锁 → 复制 → 注册 HKCU Run `WorkSwitchAll` → wscript 启动管理器。`Write-InstallLine` 函数定义必须在该分支**之前**（曾因定义在后报 CommandNotFound）。
- **uninstall all**：停管理器（supervisor.pid 校验身份后停）→ 循环停全部 profile 生命周期 → 清 Run 项 → 删目录。
- **prepare all**（安装前检查）：循环停全部生命周期，标准权限下失败即中止安装。
- `/SILENT` 跳过 postinstall（iss `skipifsilent`）——静默安装后需手动执行一次 install-win.ps1。

### 3.10 macOS 侧（`install.sh` / `relaunch-with-cdp.sh` / `apply-update.sh`）

- 有 trae-work-cn 的 case 分支（端口/数据目录/CDP 9240），但 **macOS 的 Trae 包名 `TraeWork CN.app` 是预留值，实机未验证**——接手后在 mac 上确认后修正 relaunch-with-cdp.sh 的 APP_BIN 与 profiles.js 的 appPath。
- macOS 打包（build-mac-dmg.sh）与 WorkSwitch 改名未同步（脚本内仍是 WorkDaddy 命名），CI 也不出 mac 包；做 mac 发布前需统一。macOS 没有 supervisor——沿用 launchd/手动 launcher 模式。

## 4. 开发环境与常用命令

```bash
# 启动（方式一，推荐）：一条命令完成 watchdog+daemon+CDP 启动客户端+注入
WBSWITCH_PROFILE=trae-work-cn scripts/launcher.cmd        # Git Bash 下也可

# supervisor（方案 C：按客户端运行状态自动管理各 profile）
node scripts/supervisor.js            # 前台/后台常驻（单实例锁）
node scripts/supervisor.js stop       # 停管理器（不影响已拉起的 daemon）
node scripts/supervisor.js status     # 各客户端三态快照 JSON（托盘菜单数据源）
node scripts/supervisor.js open workbuddy-ai   # 托盘/CLI：把「打开某端」意图交给 supervisor（去重拉起）
node scripts/supervisor-tray.ps1 -NodePath <node.exe> -SupervisorPath scripts\supervisor.js  # 手动/守护拉起系统托盘宿主

# 验证
node --check scripts/daemon.js && node --check scripts/inject.js
node --test test/*.test.js
curl -s http://127.0.0.1:47836/api/status          # profile/cdp 状态（会话 API 需 token）
TOKEN=$(cat "$APPDATA/WorkDaddy/profiles/trae-work-cn/.api-token")
curl -s "http://127.0.0.1:47836/api/sessions?range=all" -H "X-WorkDaddy-Token: $TOKEN"

# 只改了 inject.js：免重启重注入
curl -X POST http://127.0.0.1:47836/api/inject -H "X-WorkDaddy-Token: $TOKEN"
# 改了 daemon.js：kill 掉 daemon 进程即可，watchdog 秒级拉起新代码

# 打包（需 Inno Setup 6 + Git Bash + python；CI 也走同一套脚本；v0.3.0 起只产出全端包）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-win-release.ps1 -Version 0.3.0

# GitHub 推送（本机直连被重置，走本地代理 7897）
git -c http.proxy=http://127.0.0.1:7897 push origin main
```

**开发机现状（2026-08-30）**：生产由安装版 WorkSwitch All 托管（`%LOCALAPPDATA%\Programs\WorkSwitch All`，登录自启，supervisor 常驻）；Trae 与 WorkBuddy 均以其 daemon 0.2.0 运行中（更新渠道会在 6h 检查中自动升级；trae 自 0.3.1 起纳入渠道，本机 trae 需手动重启一次 daemon 进入渠道）。`E:\Demo\WorkSwitch` 为开发目录（当前 main = v0.3.0），其守护已清场，开发时用上面的命令按 profile 手动拉起（注意：dev 与安装版并存时会竞争同一客户端的管理权，开发某端前先 `node scripts/supervisor.js stop`）。

**发版提醒（0.3.2）**：① Release notes 需人工补「旧 AI 分身用户需手动安装全端版」；② 0.3.2 新增系统托盘宿主 + supervisor `open`/`status`——发行说明建议一句话告知用户「托盘右下角可查看/启动各客户端」；③ 带中文载荷的接口测试用 python 发送（curl -d 在 Windows 会搞坏 UTF-8）。**本机已在 0.3.2 构建时安装 Git for Windows（`C:\Program Files\Git`）与 Inno Setup 6（`%LOCALAPPDATA%\Programs\Inno Setup 6`），Setup.exe 可本地编译**（原"本机无 Inno Setup、仅 CI 验证"的说法已过时）。

## 5. 下一步开发计划（建议优先级）

1. ~~P0 — 修 CI 发布链~~ ✅（v0.0.1）
2. ~~P1 — Trae 模型能力~~ ✅（v0.1.0，§3.7；后续可选「会话级模型记忆」需再摸 composer 的 currentMode/modeList）
3. ~~P1 — Trae 会话增强~~ ✅（v0.1.0，§3.7；剩余收尾：真实删除的一次性会话验证）
4. ~~方案 C — All-in-One~~ ✅（v0.2.0/v0.3.0，§3.9/§3.8）
5. ~~方案 C — 常驻托盘宿主 + supervisor 命令~~ ✅（v0.3.2，§3.9）：`supervisor-tray.ps1` 系统托盘入口（随 supervisor 守护拉起、崩溃自补）、supervisor `open`/`status` 子命令与跨进程意图队列、托盘脚本 UTF-8 BOM 修复。
6. **P2 — Trae 账号能力**：登录态为加密存储 + Cloud-IDE-JWT（失效与刷新问题），切换账号需逆向 trae.cn 账号接口，工作量大、单独排期。
7. **P2 — Trae 主题能力**：Trae 是 VSCode fork，形态应为「workbench 主题 + CSS 注入」，需新设计而非复用现有 theme 引擎。
8. ~~**P3 — trae 更新渠道开启评估**~~ **已完成并随 v0.3.1 发布（2026-08-30）**：trae-work-cn 纳入 `WorkSwitch-All-` 渠道；前提是 apply-update.ps1 已感知管理器（更新前精确停 supervisor，成功/回滚后重启，由它按需重建生命周期——消除 daemon 自更新与管理器的竞态）。同版还升级 actions/checkout v5（消 Node 20 警告）、补写了 v0.3.0 Release notes（含旧 AI 分身手动迁移说明）。
   - **内置资产结论**：官方壁纸资产本机与 CI 均不存在（仅上游作者机器有），入库不可行、构建期下载会耦合上游——维持缺失时优雅降级；如未来需要，向上游 babygoton/WorkDaddy 拉取或自制后入库。
9. **P3 — macOS**：实机确认 Trae mac 包名；mac 打包脚本 WorkSwitch 化；评估 mac 侧 supervisor 等价物（launchd）；CI 增加 mac job。
10. **P3 — 内置资产**：`WorkDaddy.app`（builtin 壁纸来源）被 gitignore，CI 出的包无官方壁纸；把 `scripts/builtin` 入库或改构建期下载。
11. **P3 — CodeBuddy 回归**：v0.3.2 已在装有 **CodeBuddy CN 1.106**（`C:\Software\CodeBuddy CN\CodeBuddy CN.exe`）的实机验证**插件启动主链路**：托盘点击 `open codebuddy-cn` → supervisor 冷启动 → launcher 找到 exe → 带 9224 调试端口重启 → CDP 注入成功、supervisor 状态转 normal（期间修复了 `codebuddy cn.exe` 白名单漏配）。**仍未覆盖**：CodeBuddy 国际版（intl）实机、会话/签到、CORS 白名单与更新渠道在 codebuddy 上的实机行为。
12. ~~**P3 — 杂项**~~ **已完成（2026-08-30）**：actions/checkout 已升 v5；v0.3.0/v0.3.1 Release notes 已人工补写（含旧 AI 分身手动迁移说明）；README.md 已全面重写为全端单包形态（能力矩阵/管理器架构/安装迁移说明）。
13. **剩余项推进所需条件（接手者对照）**：
    - **P2 Trae 账号能力**：需逆向 trae.cn 账号接口（登录态加密 + Cloud-IDE-JWT 刷新）——建议先抓包分析 `trae-api-cn.mchost.guru` 的账号族接口，排期单独做；隐私红线不变（token 只内存态）。
    - **P2 Trae 主题能力**：先做产品决策——Trae 是 VSCode fork、用户已有原生主题体系，注入 CSS 强改会与原生设置打架；若做，建议最小化形态为「面板与注入元素跟随 Trae 当前主题色」而非整套主题引擎。
    - **P3 macOS**：需要一台 mac 实机（确认 Trae mac 包名 + 跑通 install.sh/relaunch 链路 + 出 dmg）。
    - **P3 CodeBuddy 回归**：本机已装 CodeBuddy CN 1.106，**插件启动主链路已在 v0.3.2 实机验证**（含 `codebuddy cn.exe` 白名单修复）；剩余需 cover：intl 版、会话/签到、CORS 白名单与更新渠道的 codebuddy 实机行为。
    - **P3 内置壁纸**：资产只在上游作者机器上，本机/CI 均无——维持缺失降级；需要时向上游 babygoton/WorkDaddy 拉取或自制后入库（`scripts/builtin`）。

## 6. 关键风险与约定（接手必读）

- **隐私红线**（AGENTS.md 原则 4/8）：不记录/上传 token、cookie、账号备份内容；云 API token（如 Cloud-IDE-JWT）只允许内存态使用；遥测开关与脱敏逻辑勿动。
- **进程安全**：只精确匹配本 profile 的镜像名 + 校验路径/属主/命令行；提权进程 fail-closed 给人工指引，绝不做宽名杀伤。**多 profile 进程判定必须带 `--profile=` 收尾匹配（§3.9）**。
- **数据安全**：`%APPDATA%\WorkDaddy` 数据目录与账号备份格式不变更；profile 数据隔离靠 `profileDataDir`。
- **测试是护栏**：改端口表、CDP 判定、更新渠道、身份判定、品牌串前先跑 `node --test test/*.test.js`，失败断言大多直接告诉你漏改了哪处联动。
- **CodeBuddy CN 镜像名 `codebuddy cn.exe`（v0.3.2 起）是多处同步点**：`supervisor.js` `CLIENT_IMAGE_NAMES`、`win-launcher.js` `PROFILE_PROCESS_NAMES`/`PROFILE_BINARY_NAMES`、`daemon.js` `PROFILE_BINARY_NAMES`、`windows-process-boundary.js` `ALLOWED_WORKBUDDY_PROCESS_NAMES` **四处必须都有**（后者是安全白名单，漏了会在重启前验证失败；本仓库有静态护栏测试）。intl 仍用 `codebuddy.exe`。
- **托盘脚本编码**：`supervisor-tray.ps1` / `build-win-release.ps1` 等含中文的 PowerShell 必须 UTF-8 with BOM（PS5.1 无 BOM 按 GBK 解析致 ParserError）。用 Edit 改这些文件后要检查 BOM 是否保留。
- 本仓库不是 WorkDaddy 上游的 git fork（历史从零开始），与上游 `babygoton/WorkDaddy` 的关系只在 README 致谢层面；同步上游改动请手动 cherry-pick。
