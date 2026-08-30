# WorkSwitch 交接文档

> 更新时间：2026-08-30 · 对应版本：v0.1.0（已发布：[run 33292865128](https://github.com/xiaowulai-s/Work_Switch/actions/runs/33292865128) 全绿，Release 挂三个 `WorkSwitch-*-Setup-0.1.0.exe`）
> 本文档面向接手开发者：先读「项目概览」与「开发环境」，再按模块索引查细节。
> 工作区规范（不可违背的原则、打包 Runbook、验证命令）以根目录 `AGENTS.md` 为准，本文不重复。

## 1. 项目概览

WorkSwitch（fork 自 WorkDaddy）是 AI 桌面客户端的本地增强层：通过 Chrome DevTools Protocol（CDP）向正在运行的 Electron 客户端注入一个面板，本地 daemon 提供账号备份/切换、会话管理、防休眠等能力。**零侵入、只走 CDP 和本地文件，不改官方 app.asar，daemon 只绑 127.0.0.1。**

当前支持 5 个客户端（每端一个独立 daemon 实例，由 `WBSWITCH_PROFILE` 环境变量绑定）：

| profile | 客户端 | kind | UI 端口 | CDP 端口 | 已开放能力 |
|---|---|---|---|---|---|
| `workbuddy-cn` | WorkBuddy 国内版 | workbuddy | 47832 | 9222 | 全部（账号/会话/模型/暂存/主题/签到） |
| `workbuddy-ai` | WorkBuddy AI 国际版 | workbuddy | 47833 | 9223 | 全部（签到除外） |
| `codebuddy-cn` | CodeBuddy 国内版 | codebuddy | 47834 | 9224 | 会话只读 + 签到 |
| `codebuddy-intl` | CodeBuddy 国际版 | codebuddy | 47835 | 9225 | 会话只读 + 签到 |
| `trae-work-cn` | Trae Work CN（字节 TraeWork） | trae | 47836 | 9240 | 会话只读 + **在线模型列表/切换**（模型能力见 §3.7） |

内部约定（勿改，多处依赖）：API 协议头 `X-WorkDaddy-Token`；数据目录 `%APPDATA%\WorkDaddy`（非 CN profile 在其下 `profiles\<id>` 子目录）；注入占位符 `__WBS_*` 系列；`WBS_` 前缀的内部标识。

## 2. 当前进度（截至 2026-08-29）

**已完成并合入 main（commit a9d8a9c，tag v0.0.1）：**

1. **Trae Work CN 全链路接入**（首个 kind=trae 客户端）：
   - launcher 拉起链路：`win-launcher.js` 支持 `TRAE SOLO CN.exe`（默认装 `%LOCALAPPDATA%\Programs\TRAE SOLO CN`，自定义盘根目录走注册表 `TraeWork|TRAE SOLO` 匹配 + 盘根候选 + 扫描目录兜底；进程白名单 `trae solo cn.exe` 已加入 `windows-process-boundary.js`）。
   - CDP 注入管线：workbench 页面 target 为 `vscode-file://vscode-app/.../solo/solo-lite.html`，归属判定强信号 = URL 中的安装目录 `TRAE SOLO CN`。
   - **只读会话列表**（详见 §3.4）：面板「会话」页显示侧栏任务列表的真实数据（标题/空间/时间），已实机验证。
2. **WorkSwitch 品牌化**：面板品牌、安装名（WorkSwitch / WorkSwitch AI / WorkSwitch Trae）、安装包名（`WorkSwitch[-AI|-Trae]-Setup-x.y.z.exe`）、更新资产前缀、About 页文案全部切换；更新仓库指向 `xiaowulai-s/Work_Switch`；`DAEMON_VERSION = 0.0.1`。
3. **自动更新渠道声明制**：`UPDATE_CHANNEL`（daemon.js）按 profile 登记资产前缀，未登记的（codebuddy-*/trae-*）完全不触达 Releases API——顺带修复了旧版 codebuddy 会误选 WorkDaddy CN 安装包的隐患。
4. 251 项测试全过；`node --check` 全绿。

**当前阻塞项：**

- ~~CI 发布链失败~~ **已解决（2026-08-30）**：v0.0.1 已重发成功，[run 33289225389](https://github.com/xiaowulai-s/Work_Switch/actions/runs/33289225389) 全绿，Release 挂上三个 `WorkSwitch-*-Setup-0.0.1.exe`（无 ZIP、无提示词文件）。原失败有两个叠加根因，均已修复并有回归测试：
  1. **workflow CRLF 校验恒假**（run 33250380974，step 3）：Git Bash 的 GNU grep 读文本文件会剥离 CR，`grep -q $'\r'` 对 CRLF 文件恒不命中。已改字节统计（`tr -cd '\r'` 计数，出现纯 LF 行才报错），并规范 `launcher.cmd`/`install-win.cmd`/`Install-WorkDaddy.cmd` 为全 CRLF（commit b1e1d3b）。
  2. **暂存打包 python 块 cp1252 崩溃**（run 33287632416，step 6）：Windows CI 的 Python 3.12 管道 stdout 默认跟随 ANSI 代码页，品牌化块中文 print 抛 `UnicodeEncodeError`（本机 Python 默认 UTF-8 所以没复现）。已在 build-win-zip.sh `export PYTHONUTF8=1` + 两个品牌化块内 `sys.stdout.reconfigure(utf-8)` 兜底（commit 72c2228）。
  - 教训：CI 的两个坑都是「本机环境与 CI 环境默认值不同」——本机 grep 是 ugrep、本机 python 默认 UTF-8，导致本地全绿、CI 必挂。写 CI 校验/打包逻辑时先确认 runner 环境默认值。
  - 发布路径采用「删远端 tag 重打 v0.0.1」（两次），tag 必须指向包含 workflow 修复的提交，CI 才会用到新逻辑。

**2026-08-30 新增（已随 v0.1.0 发布）：**
**2026-08-30 新增（方案 C 已完成并发布）：**

- **v0.3.0（当前发布形态）**：发布物收敛为全端单包——Release 只挂 `WorkSwitch-All-Setup-x.y.z.exe`，三个分身安装包下架（CI 只构建 all；zip/release 默认循环只跑 all）。更新渠道收敛：workbuddy-cn/ai 的 UPDATE_CHANNEL 统一为 `WorkSwitch-All-`；**旧 CN 分身（0.1.0/0.2.0）会经自身旧代码的兜底正则自动升级到全端版**（安装器自带迁移，精确停旧生命周期）；**旧 AI 分身需手动安装一次**（其旧正则锁死 WorkSwitch-AI- 前缀，匹配不到新资产——发版说明里必须写明）。trae/codebuddy 维持 null 渠道。AGENTS.md 发版 Runbook 已同步（唯一交付物 + 载荷抽查含 supervisor）。
- 本机生产：安装版 WorkSwitch All（`%LOCALAPPDATA%\Programs\WorkSwitch All`）托管全部客户端，登录自启已注册；dev 目录仅作开发。

6. **All-in-One（单安装包承载全部客户端）**：
   - `scripts/supervisor.js`（新增）：常驻管理器，轮询检测各 profile 客户端运行状态，daemon/CDP 不可用时调用 win-launcher 补齐（launcher 幂等）；客户端未运行不做任何事。CodeBuddy 双版共用镜像名，仅在 CDP 端口可判别版本时管理。单实例锁（`%APPDATA%\WorkDaddy\supervisor.pid`）+ `node supervisor.js stop`。
   - **多 profile 进程身份修复（关键地基）**：同目录多 profile 的 (node, 脚本) 进程身份完全相同，watchdog 会把别的 profile 的 watchdog 当成自己的（pid 文件互写、daemon 起不来，实机复现）。修复：watchdog/daemon 启动命令行携带 `--profile=<id>`（daemon.js/watchdog.js 支持 argv 覆盖 env），windows-process-boundary 的过滤器/断言新增 `expectedProfileId` 严格尾参匹配。升级后旧 daemon 由 launcher 按版本强制重启自然带上新参数。
   - 打包链 all 模式：`WORKDADDY_BUILD_PROFILE=all` → `WorkSwitch-All-Setup-x.y.z.exe`（独立目录/独立 AppId，与旧分身共存）；install-win.ps1 all 分支做迁移（精确停旧分身生命周期）+ 注册 HKCU Run 自启 + 启动管理器；uninstall/prepare/verify 同步支持。
   - 实机验证：杀全部 Trae 生命周期后 supervisor 一个轮询周期重建（客户端零扰动）；WorkBuddy 检测+拉起验证通过；all 模式暂存包载荷抽查通过。
   - **v0.2.0 已发布**：首次 CI 失败（默认打包循环缺 all 的 zip）修复后重发，[run 33297702555](https://github.com/xiaowulai-s/Work_Switch/actions/runs/33297702555) 全绿，Release 挂 4 个 `*-Setup-0.2.0.exe`（三分身 + All）。
   - **真机安装冒烟通过**：`WorkSwitch-All-Setup-0.2.0.exe /VERYSILENT` 安装 → install-win.ps1 all 分支注册自启并启动管理器（内置 node）→ 正常方式启动 WorkBuddy/Trae → 管理器自动以 CDP 重启并注入 → 两端面板与功能 API 全部可用。注意 `/SILENT` 会跳过 iss 的 postinstall（skipifsilent），静默安装后需手动执行一次 install-win.ps1 -Profile all。
   - **launcher 关闭 flake 修复**：WorkBuddy 的 GUI 子进程不处理 WM_CLOSE，优雅轮 taskkill 失败原先立即 fail-closed（客户端死在半路）；现改为记日志继续，由既有的两轮强杀收尾（身份逐个复验，安全属性不变）。
   - 交接提示：本机当前 supervisor 正在运行（node supervisor.js，root 数据目录有 supervisor.pid）；Trae 由其托管。


5. **Trae 在线模型列表/切换 + 会话重命名/删除**（daemon 0.1.0）：模型 tab 对 trae 实装（Auto Mode 置顶 + 内置模型分组 + 倍率/受限标签），收集器 `__wbsTraeModels` 临时展开官方下拉收割后恢复；`__wbsTraeSessionOps` 走侧栏「更多」菜单完成重命名/删除（不触达云 API，无 token 处理）。API：`/api/trae/models`（GET）、`/api/trae/models/switch`、`/api/trae/sessions/rename`、`/api/trae/sessions/delete`（均 POST）。实机全链路验证通过。细节与坑见 §3.7。

**明确未做（见 §5 开发计划）：** Trae 的模型/账号/主题能力、macOS 包、macOS Trae 包名实机确认。

## 3. 模块实现细节（含关键设计决策与坑）

### 3.1 profile 注册与端口

- `scripts/profiles.js`：唯一注册点。每个 profile 声明 appPath/dataRoot/authFile/sessionDb/modelsFile/apiHost/capabilities/targetHints/appName。未知 profile 直接抛错（fail-closed）。
- UI 端口：`scripts/ui-port.js` `PROFILE_UI_PORTS`（主端口 + 17xxx/27xxx/37xxx 回退段）；CDP 端口：`daemon.js` `PROFILE_CDP_PORT` 与 `win-launcher.js` `PROFILE_CDP_PORTS`。**注意**：workbuddy-cn 的 CDP 回退段占 9226-9232、workbuddy-ai 占 9233-9239，**新 trae 系客户端从 9240 起分配**（trae-work-cn=9240）。`ui-port.js` 对未知 profile 会静默回落 47832——加新 profile 时必须同步端口表并更新 `test/ui-port.test.js` 的互斥断言。
- `appPath` Windows 安装路径不一定真实存在（自定义安装），win-launcher 有注册表/盘根兜底（见 §3.6）。

### 3.2 CDP target 归属判定（`scripts/cdp-targets.js`，纯函数）

- `classifyTarget`：强信号 = app 包路径 / 登录域名。Trae Work CN 的强信号正则 `APP_TRAE_WORK_CN = /\/TRAE SOLO CN(?:\.app)?(?:\/|$)/i`（Windows 的 vscode-file URL 归一化后含安装目录；macOS 包名 `/Applications/TraeWork CN.app` 为预留值，**实机未验证**）。
- `isTargetForProfile`：强信号命中即严格比对 profile id；无强信号时 kind 宽松兜底（codebuddy/trae 要求 URL 以 vscode-file 开头或 haystack 含产品名；trae 额外要求 /trae/i 或 vscode-file，防误连）。改动这里必须同步 `test/cdp-targets.test.js`。

### 3.3 daemon（`scripts/daemon.js`，注意它是 34 万字符的大文件）

- **会话层分 kind**：`sqliteRun`（写）只允许 kind=workbuddy；`sqliteQuery`（读）三路：workbuddy 直读 SQLite、codebuddy 走 `codeBuddySessionRows()`（明文 vscdb）+ SQL 形状过滤、**trae 走 `traeSessionRows()`**（CDP 读渲染层收集器）+ `filterTraeSessionRows()`（支持主列表/DISTINCT cwd 两种 SQL 形状 + uid/时间参数过滤）。
- **注入时占位符替换**（`injectWidget` 内）：`__WBS_PROFILE__`、`__WBS_PROFILE_KIND__`（本次新增，inject.js 的 kind 维度）、`__WBS_CAPS__`、`__WBS_API_TOKEN__` 等。inject.js 是**每次注入都重新读文件**的——改了 inject.js 不用重启 daemon，调 `POST /api/inject`（带 token）即可重注入；改了 daemon.js 才需要重启（watchdog 检测到版本不一致会自动重启 daemon，所以开发时直接 `taskkill` daemon 进程即可，watchdog 几秒内拉起新代码）。
- **CORS 白名单**：`isAllowedApiOrigin` 必须包含 `vscode-file://` 前缀（CodeBuddy/Trae workbench 的 Origin），否则面板所有 fetch 静默失败（`net::ERR_FAILED`，Network 域无 blockedReason，日志无请求痕迹）。这是 Trae 接入时踩的最大坑。
- **更新**：`UPDATE_CHANNEL = 'WorkSwitch-AI-' / 'WorkSwitch-' / null`；checkUpdate 对 null 短路；下载/安装路由双重拒绝。资产正则按渠道字面量分组（`WorkSwitch-(?!AI-)` 负向断言防误配 AI 包）——新增渠道时在这里登记专属正则，`test/update-channel.test.js` 是护栏。
- cdpSend **返回值已剥一层**：取值用 `r.result.value`（不是 `r.result.result.value`）——traeSessionRows 曾因此静默返回空列表。

### 3.4 inject.js（注入面板，51 万字符）

- 顶部（`__wbsWidget` 守卫**之前**）安装 `window.__wbsTraeSessions`（仅 `'__WBS_PROFILE_KIND__' === 'trae'` 时）：沿 DOM 元素的 `__reactFiber$` 键向上走 ≤14 层 return，收集含 `props.group`（有 id/children/name）的 fiber，把 `group.children` 中 `type==='session'` 的项映射为会话行（sessionId→id、name→title、mainFolder→cwd、updateAt→时间三兄弟、mode/env/project 附加）。**为什么走渲染层**：Trae 本地会话库 `ModularData/ai-agent/database.db` 是加密 SQLite（node:sqlite 打开报 file is not a database），云端列表接口 `trae-api-cn.mchost.guru/api/remote/v1/chat_sessions` 只在页面加载时拉一次、空闲无流量（且带 Cloud-IDE-JWT，重放需抓 token，收益低）；侧栏 fiber 状态是唯一稳定源。收集器无状态、重注入整段覆盖，无缓存失效问题。
- CAPS 门控：accounts/models/theme/stashPrompt/sessions 各自控制 tab 增删。**注意两处易错**：① `!CAPS.accounts` 分支里做了默认激活 tab 的回退（会话可用→会话，否则→电脑→关于）；② `logoutBtn` 只有账号 pane 存在时才非空，build() 尾部挂监听必须 `if (logoutBtn)`——曾因无条件挂监听导致 build() 中途抛错，**连锁**导致其后才赋值的 `ND_DEFS` 为 undefined，用户点「增强」页时报 `ND_DEFS.length` 崩溃（根因已修，表现为增强页崩溃时先查 logoutBtn）。
- daemon 侧注入 `__WBS_PROFILE_KIND__`（workbuddy/codebuddy/trae），新 kind 专属 UI 逻辑用它门控，别再堆 PROFILE_ID 前缀判断。
- 面板 → daemon 的 fetch 从 vscode-file origin 发出，依赖 §3.3 的 CORS 白名单。

### 3.5 安装与打包链（Windows）

- 链路：`build-win-release.ps1`（三 profile 循环）→ `build-win-zip.sh`（暂存 ZIP + 打包期替换）→ `build-win-installer.ps1`（Inno Setup 编 Setup.exe，`scripts/win/workdaddy.iss` 全参数驱动）。
- **打包期文本替换的三个坑**（改打包逻辑前必读 `build-win-zip.sh` 3.2a/3.3a/3.3b 注释）：
  1. ps1 只替换 param 默认值处的 `__WBS_DEFAULT_PROFILE__` 占位符，**绝不能全局替换**（会破坏 AI 包的白名单判断）；
  2. win-launcher.js 默认 profile 只在源码仍是 `|| 'workbuddy-cn'` 字面量时替换——**源码里这个默认值不能改成别的**；
  3. AI/Trae 包品牌化块按「基准串 → 变体串」做文本替换（含 `verify-win.cmd` 的安装目录/桌面 lnk 自检路径、`install-win.cmd` 的两条 base64 成功提示）——**改 cmd/ps1 基准文案时必须同步改 zip 脚本里对应的新旧串对**，否则自检路径错乱或替换 MISS。`test/update-layout.test.js` 里的 CRLF 品牌化测试会实际跑这段 python。
- 品牌名映射集中在各脚本顶部的三分支（productName/packageName/startDescription/Run 项清理名单——名单同时保留 WorkDaddy 旧名用于升级迁移清理）。
- daemon 版本一致性：zip 打包期强制把 staged daemon.js 的 `DAEMON_VERSION`/`DAEMON_BUILD_ID` 重写为发布版本——所以 **tag 发布时 CI 用的是源码里的 DAEMON_VERSION，改版本号要改源码**。

### 3.6 Windows 启动器（`win-launcher.js`）

- 每类 profile 有 `PROFILE_PROCESS_NAMES`/`PROFILE_BINARY_NAMES`（精确镜像名小写），进程查询/退出判定只认自己的镜像，绝不全名杀伤。
- exe 发现顺序：PROFILE.appPath → App Paths 注册表（按 profile 分 key）→ 卸载注册表（Trae 用 `TraeWork|TRAE SOLO`，**不能匹配裸 "Trae"**，会抓到 Trae IDE）→ 常见路径 → 盘根候选 → 安装目录 PowerShell 扫描。误报由 `selectPreferredDiscoveredBinary` 按镜像名兜底过滤。
- 已知偶发：验证后进程已自行退出时 taskkill 返回 1 → fail-closed 报错（设计如此）。重跑一次 launcher 即可。

### 3.7 Trae 在线模型能力（§2 新增项 5 的实现细节）

- **数据源**：模型目录服务端下发（state.vscdb 的 `AI.agent.model.model_list_map` 只是缓存，应用运行时持锁不可直写）。权威的「可选列表 + 当前选中」在 composer 顶部 `core-model-select` 下拉里：`[role="option"]` 项 + 非 option 的 `.core-model-select-auto-mode-item`（Auto Mode 入口，`active` 类=当前生效）+ `.core-model-select-model-group-label`（分组头「内置模型」）。
- **收集器**（inject.js `__wbsTraeModels`，kind=trae，widget 守卫之前）：`list()` 与 `switchTo(key)` 都返回 `Promise<string(JSON)>`，daemon 侧 `traeModelCollectorCall` 用 `Runtime.evaluate awaitPromise:true` 取值（`r.result.value` 已剥一层）。操作方式是派发与用户一致的指针事件后立即恢复原状，无监听器/无 observer。
- **三个必须踩对的点**（都实测踩过）：
  1. **派发的 PointerEvent 必须带 `pointerType: 'mouse'`**——Radix 校验 pointerType，缺省 `''` 不触发选择。
  2. **下拉刚展开时选择处理器未挂载完成**，立即点击无效；用「触发后下拉自行收起 = 选中成功」信号重试（≤3 次，每次 800ms）。固定 300ms 等待不够。
  3. **受限模型与普通模型的渲染路径不同**：受限项的 fiber 链上有 `item`/`onItemClick` prop，普通项没有——模型显示名必须从 `.core-model-select-model-item-name` DOM 子元素读取，fiber item 仅作补充元数据。
- **UI**（`buildTraeModelsPane`，buildModelsPane 按 `WBS_PROFILE_KIND === 'trae'` 分流）：Auto Mode 置顶行 + 分组头 + 行内倍率/无权限胶囊；restricted 行灰显不可点；事件委托 + Enter/Space 键盘可达；刷新按钮 id 为 `wbs-trae-model-refresh`（不得撞 WorkBuddy 的 `wbs-model-refresh`——update-layout.test.js 有静态断言）。
- **API**：`GET /api/trae/models`、`POST /api/trae/models/switch {key}`（`__auto__`=Auto Mode）；仅 `PROFILE.kind === 'trae'`，鉴权走 handleApi 全局门。面板 `api()` 对 `!ok` 抛错，切换失败会重载列表并显示 tip。
- **会话重命名/删除**（`__wbsTraeSessionOps`，kind=trae）：重命名驱动侧栏「更多」菜单（行 `taskMoreB` 按钮 → `.task-list-menu` → 重命名项 → 行内 `textarea.task-list-rename-input` 自动聚焦 → React 原生 value setter + input 事件 + Enter）；删除驱动菜单「删除任务」项 → Trae 自带「确认删除」弹窗（`.dialog-` 前缀类名，无 role=dialog）→ 点其中文案恰为「删除」的按钮。安全约束：同名会话 >1 或目标不在当前侧栏视图时一律拒绝（`_rowCount(title) !== 1`），绝不滚动/切换视图去找；面板侧另有确认弹窗，双重确认。**真实删除未在用户数据上执行**（无法安全构造一次性会话——New task 不发送消息不产生侧栏条目），弹窗出现/取消已实机验证。
- **会话分页结论**：侧栏组件 `hasMoreSessions=false`（当前视图已全量加载），收集器映射的是分组完整 children——**分页增强无需实现**；但侧栏按工作区过滤视图，收集器只反映当前视图（389→1 的波动即视图切换所致），这是「只读已挂载分组」的固有语义。
- **测试工具链坑**：Windows Git Bash 下 `curl -d` 发中文 JSON 会因代码页把 UTF-8 载荷搞坏（症状：API 假性「未找到」），带中文的接口测试必须用 python/文件体发送，ASCII 载荷不受影响。
- **测试**：`test/trae-models.test.js`（模型 + 会话操作的静态护栏）+ profiles.test.js 能力组合更新。运行时行为只在 Trae 实机验证过，无 Trae 环境时这些静态断言是唯一护栏。

### 3.8 macOS 侧（`install.sh` / `relaunch-with-cdp.sh` / `apply-update.sh`）

- 有 trae-work-cn 的 case 分支（端口/数据目录/CDP 9240），但 **macOS 的 Trae 包名 `TraeWork CN.app` 是预留值，实机未验证**——接手后在 mac 上确认后修正 relaunch-with-cdp.sh 的 APP_BIN 与 profiles.js 的 appPath。
- macOS 打包（build-mac-dmg.sh）与 WorkSwitch 改名未同步（脚本内仍是 WorkDaddy 命名），CI 也不出 mac 包；做 mac 发布前需统一。

## 4. 开发环境与常用命令

```bash
# 启动（方式一，推荐）：一条命令完成 watchdog+daemon+CDP 启动客户端+注入
WBSWITCH_PROFILE=trae-work-cn scripts/launcher.cmd        # Git Bash 下也可
# 方式二（调试）：手动两步
WBSWITCH_PROFILE=trae-work-cn node scripts/daemon.js &
"D:\TRAE SOLO CN\TRAE SOLO CN.exe" --remote-debugging-port=9240 &

# 验证
node --check scripts/daemon.js && node --check scripts/inject.js
node --test test/*.test.js
curl -s http://127.0.0.1:47836/api/status          # profile/cdp 状态（会话 API 需 token）
TOKEN=$(cat "$APPDATA/WorkDaddy/profiles/trae-work-cn/.api-token")
curl -s "http://127.0.0.1:47836/api/sessions?range=all" -H "X-WorkDaddy-Token: $TOKEN"

# 只改了 inject.js：免重启重注入
curl -X POST http://127.0.0.1:47836/api/inject -H "X-WorkDaddy-Token: $TOKEN"
# 改了 daemon.js：kill 掉 daemon 进程即可，watchdog 秒级拉起新代码

# 本机打包（需 Inno Setup 6 + Git Bash + python3；CI 也走同一套脚本）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-win-release.ps1 -Version 0.0.1

# GitHub 推送（本机直连被重置，走本地代理 7897）
git -c http.proxy=http://127.0.0.1:7897 push origin main
```

开发机现状（2026-08-29）：daemon 0.0.1 常驻（47836，watchdog 托管）、Trae Work CN 带 CDP 9240 运行中、面板已注入且会话页可用。

## 5. 下一步开发计划（建议优先级）

1. ~~**P0 — 修 CI 发布链**~~ **已完成（2026-08-30）**：见 §2 阻塞项。Release v0.0.1 已挂三个 Setup.exe；包内内容已按 AGENTS.md 抽查（暂存包层面：daemon 0.0.1、node.exe、各 profile 串、无提示词/无嵌套 ZIP）。Setup.exe 编译产物由 CI 的 verify-win.cmd 自检步覆盖，本机无 Inno Setup 未做 innounp 抽查。
2. ~~**P1 — Trae 模型能力**~~ **已完成并随 v0.1.0 发布（2026-08-30）**：列表读取 + 点击切换 + Auto Mode 还原全链路实机验证通过，见 §3.7。后续如需「会话级模型记忆」（每个会话独立模型）需再摸 composer 状态里的 currentMode/modeList。
3. ~~**P1 — Trae 会话增强**~~ **基本完成并随 v0.1.0 发布（2026-08-30）**：分页经实测无需实现（`hasMoreSessions=false`，当前视图全量加载，见 §3.7）；删除/重命名已走侧栏官方菜单实装（比云 API 方案更符合零侵入，完全不涉及 Cloud-IDE-JWT）。剩余收尾：真实删除的一次性会话验证（需构造可丢弃会话）。
4. **P2 — Trae 账号能力**：登录态为加密存储 + Cloud-IDE-JWT（有失效与刷新问题），切换账号需逆向 trae.cn 账号接口，工作量大、单独排期。
5. **P2 — Trae 主题能力**：Trae 是 VSCode fork，主题体系与 WorkBuddy 完全不同；若做，形态是「workbench 主题 + CSS 注入」，需新设计而非开关现有 theme 引擎。
6. **P3 — macOS**：实机确认 Trae mac 包名；mac 打包脚本 WorkSwitch 化；CI 增加 mac job（现有 workflow 仅 Windows）。
7. **P3 — 内置资产**：`WorkDaddy.app`（builtin 壁纸来源）被 gitignore，CI 出的包无官方壁纸；如需要，把 `scripts/builtin` 资产入库或改为构建期下载。
8. **P3 — CodeBuddy 回归**：本次改了 CORS 白名单和更新渠道门控，codebuddy 双端的注入/会话/签到建议在实机过一遍（本机未装 CodeBuddy，静态+测试覆盖）。

## 6. 关键风险与约定（接手必读）

- **隐私红线**（AGENTS.md 原则 4/8）：不记录/上传 token、cookie、账号备份内容；云 API token（如 Cloud-IDE-JWT）只允许内存态使用；遥测开关与红acted 逻辑勿动。
- **进程安全**：只精确匹配本 profile 的镜像名 + 校验路径/属主/命令行；提权进程 fail-closed 给人工指引，绝不做宽名杀伤。
- **数据安全**：`%APPDATA%\WorkDaddy` 数据目录与账号备份格式不变更；profile 数据隔离靠 `profileDataDir`。
- 测试是护栏：改端口表、CDP 判定、更新渠道、品牌串前先跑 `node --test test/*.test.js`，失败断言大多直接告诉你漏改了哪处联动。
- 本仓库不是 WorkDaddy 上游的 git fork（历史从零开始），与上游 `babygoton/WorkDaddy` 的关系只在 README 致谢层面；同步上游改动请手动 cherry-pick。
