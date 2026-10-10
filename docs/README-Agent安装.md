# Agent 安装指南：Obsidian 工作投递管理

本指南供朋友的 Agent 安装 v2.0.0 使用。成品包含 Obsidian 就业插件、Chrome 岗位采集及本机连接运行环境，不需要安装 Python、Node、Codex 或其他 Obsidian 插件。

仓库：[KEDA-gagaga/obsidian-job-manager](https://github.com/KEDA-gagaga/obsidian-job-manager)  
下载：[v2.0.0 Releases](https://github.com/KEDA-gagaga/obsidian-job-manager/releases/tag/v2.0.0)

## 1. 确认安装目标

先确认用户实际授权安装的 Obsidian 库绝对路径、操作系统和芯片架构；不要根据当前工作目录猜测库位置。用户已提供路径时直接检查，不重复询问。

- 支持 Windows x64、macOS arm64、macOS x86_64；不提供 Linux 安装包。
- 支持默认 `.obsidian/` 配置目录。用户使用自定义配置目录时，说明限制并选择其授权的新专用库，不自动改全库配置。
- 基础管理要求 Obsidian 1.8.0+；Chrome 采集要求 **Obsidian 1.12.7+ 安装器**，并在「设置 → 常规」启用命令行接口。应用内部更新不一定代表安装器已升级。
- 安装和升级前关闭 Obsidian，让用户保存未保存内容，不强制结束进程。完成后再打开目标库。
- Chrome 连接指向最近一次安装选择的库。同名库需先明确区分；换电脑或移动库后重新登记连接。

## 2. 已有库保护与安装前检查

只操作本模块。不要复制整份他人的库，不安装其他私人模块，不上传本地简历、投递记录或配置。

检查以下位置：

| 位置 | 处理原则 |
|---|---|
| `<库>/.obsidian/plugins/keda-job-applications/` | 已存在时读取 `job-manager-install.json`，其 `product` 必须为 `obsidian-job-manager`，才能按升级处理 |
| `<库>/工作投递/` | 首次安装时若同名目录已存在，停止覆盖并说明冲突；不要自动移动、改名或删除用户内容 |
| `<库>/.obsidian/` 与目标目录 | 本版拒绝符号链接目标；使用用户明确指定的实际库位置 |
| 已有就业数据与设置 | 保留，不清空、不用模板覆盖、不直接改整份业务 JSON |
| 其他插件、主页、日记、全库规则 | 保持原样；不要替换 `.obsidian/` 或第三方插件启用列表 |

安装器会核对冲突，升级前备份本插件及业务数据。异常数据、非本发行版同名插件或其他版本的 Chrome 本机连接会拒绝覆盖。遇到拒绝应报告具体原因，不绕过检查手动覆盖。

如果用户只提供源码仓库，优先下载 Release 成品，**不要直接执行源码中的 `installer/tool.py` 作为安装器**；成品才包含对应系统的运行环境。

## 3. 下载、校验和解压

| 系统 | 安装包 | 程序 |
|---|---|---|
| Windows x64 | `obsidian-job-manager-2.0.0-windows-x64.zip` | `runtime/JobManager.exe` |
| Apple 芯片 Mac | `obsidian-job-manager-2.0.0-macos-arm64.zip` | `runtime/JobManager` |
| Intel Mac | `obsidian-job-manager-2.0.0-macos-x64.zip` | `runtime/JobManager` |

优先使用用户已收到的 ZIP 和同名 `.zip.sha256` 文件。仓库为私有：Agent 没有访问权限时，请用户提供已下载的安装包或获得仓库权限，不索取账号密码或令牌。

已有 GitHub CLI 且已授权该仓库时，可执行：

```text
gh release download v2.0.0 --repo KEDA-gagaga/obsidian-job-manager --pattern "obsidian-job-manager-2.0.0-windows-x64.zip" --pattern "obsidian-job-manager-2.0.0-windows-x64.zip.sha256" --dir <下载目录>
```

Mac 将两个文件名换为对应的 `macos-arm64` 或 `macos-x64`；目录参数使用实际路径并按当前 shell 正确加引号。GitHub CLI 为可选下载工具，不是运行依赖。

验证 ZIP 的 SHA256 等于校验文件第一段十六进制值。不一致时停止使用，重新下载。解压到一个新的、长期保留的目录，不覆盖未知的既有目录。Chrome 会持续读取这里的 `chrome-extension/`，安装后不要随意删除或移动它。

程序没有系统代码签名；如系统拦截，按提示允许来自本仓库的该程序，不关闭全局安全保护、不全局放宽 PowerShell 执行策略、不递归移除其他文件的隔离标记。

## 4. 执行安装：提供参数，避免交互等待

下列变量均由 Agent 用已确认的实际路径填写。`jobPackage` 是解压后的内层文件夹，应包含 `runtime/`、`obsidian-plugin/`、`chrome-extension/` 和 `templates/`。

必须使用 **Release 解压目录中的程序** 执行安装；不要从系统应用支持目录中的运行副本发起安装，该副本不包含插件和模板材料。

### Windows PowerShell

```powershell
# 替换为用户确认的实际目录。
$jobPackage = 'D:\Apps\obsidian-job-manager-2.0.0-windows-x64'
$jobVault = 'D:\Obsidian\求职库'
# 已启用 Obsidian CLI 并登记到 PATH 时可这样定位。
$jobCli = (Get-Command obsidian -ErrorAction Stop).Source
$jobTool = Join-Path $jobPackage 'runtime\JobManager.exe'
& $jobTool --install --vault $jobVault --cli $jobCli
if ($LASTEXITCODE -ne 0) { throw '安装失败：读取实际报错，不继续配置或宣称成功。' }
```

CLI 尚未加入 PATH 时，先定位实际安装的 Obsidian 命令行程序，通常为 `Obsidian.com`，将 `$jobCli` 设置为核实过的绝对路径。不要把图标快捷方式当作命令行程序。

### macOS Terminal

```sh
# 在终端逐步执行，替换实际路径。
jobPackage="$HOME/Applications/obsidian-job-manager-2.0.0-macos-arm64"
jobVault="$HOME/Documents/求职库"
jobCli="/Applications/Obsidian.app/Contents/MacOS/obsidian"
"$jobPackage/runtime/JobManager" --install --vault "$jobVault" --cli "$jobCli"
```

Intel Mac 使用 `macos-x64` 文件夹。Obsidian 安装在其他目录时替换 `jobCli`，检查程序存在且可运行。退出码非零时读取实际报错，不执行后续配置。

`--vault` 可创建不存在的新库目录，所以安装前必须核实路径，防止拼写错误意外创建新库。只安装基础管理且尚未配置 CLI 时，可省略 `--cli`，安装器自动检测；未检测到 CLI 不影响安装，但 Chrome 采集不能验收为已完成。以后登记 CLI 时重新运行上述安装命令即可。

不要调用有 `pause` 或等待回车的 `.cmd`／`.command` 外壳作为 Agent 的非交互命令，直接使用 `runtime/JobManager` 程序。

## 5. 启用插件和 Chrome 扩展

1. 打开目标 Obsidian 库。在「设置 → 第三方插件」中启用「工作投递」。如当前库未允许第三方插件，按用户授权在界面操作，不覆盖整份插件配置。
2. 点击左侧公文包，或执行命令「工作投递：打开工作投递控制台」。确认打开的是目标库，控制台能显示空白或原有数据。
3. 在 Obsidian「设置 → 常规」启用命令行接口，确认使用符合要求的安装器。
4. Chrome 打开 `chrome://extensions/`，启用开发者模式，点击「加载已解压的扩展程序」，选择 `<jobPackage>/chrome-extension/`，可固定到工具栏。
5. 扩展编号应为 `jhpejkfkpahkflhdpbmkbkkjaakkamoo`。不要删除 manifest 的公开 `key` 或重新生成编号，否则本机连接的白名单不匹配。

浏览器和 Obsidian 的界面步骤可由拥有相应工具及权限的 Agent 完成；工具不可用时明确列出剩余操作，不声称已经完成。不直接编辑 Chrome 的 Preferences 或 Secure Preferences 来绕过扩展安装。

## 6. 连接检查与验收

目标 Obsidian 库打开、插件启用后运行：

```powershell
# Windows，沿用上面的变量。
& $jobTool --diagnose
```

```sh
# Mac，沿用上面的变量。
"$jobPackage/runtime/JobManager" --diagnose
```

正常输出应包含「Obsidian 与工作投递插件连接正常」以及版本、扩展编号、本机登记路径。诊断只验证 Obsidian、插件和连接配置，**不代表 Chrome 扩展已经加载或实际保存已验收**。

随后打开真实的具体岗位网页，点击扩展，确认预览显示目标库、企业和岗位。只有用户授权添加该岗位时才保存；否则仅预览。保存后核对目标库控制台与保存回执；同一岗位再次保存应去重，保留个人进度和备注。需要写入测试记录时先明确用户授权或使用隔离测试库。

完成报告至少说明：目标库、插件版本、扩展是否已加载、诊断结果、实际预览／保存验证范围，以及尚未完成的步骤。不要把自动构建成功当成朋友电脑上的端到端验收。

## 7. 文件定位与排错

| 对象 | 位置 |
|---|---|
| 业务数据 | `<库>/工作投递/数据/工作投递数据.json` |
| 基础简历 | `<库>/工作投递/简历/基础工作简历-纯文本版.md` |
| 日记、附件、AI 结果 | `<库>/工作投递/日记/`、`附件/`、`AI结果/` |
| 插件设置 | `<库>/.obsidian/plugins/keda-job-applications/data.json` |
| 本模块备份 | `<库>/.obsidian/job-manager-backups/` |
| Windows 运行副本 | `%LOCALAPPDATA%\ObsidianJobManager\runtime\` |
| Windows Chrome 登记 | `HKCU\Software\Google\Chrome\NativeMessagingHosts\kg.keda.job_capture` |
| macOS 运行副本 | `~/Library/Application Support/ObsidianJobManager/runtime/` |
| macOS Chrome 登记 | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/kg.keda.job_capture.json` |

运行副本下的 `config.json` 记录目标库与 CLI 路径；它是私人运行配置，不能上传仓库或共享给朋友。连接异常优先核实这份配置和真实库路径，通过安装器重新登记，不手写替换整个业务 JSON。

| 报错或现象 | 下一步 |
|---|---|
| 缺少本系统运行环境 | 检查是否拿到了 Release 成品，以及解压结构是否完整 |
| 已有同名插件／目录，拒绝覆盖 | 保留原文件，报告冲突，选择用户授权的其他库；迁移旧系统另行处理 |
| 未找到 CLI／eval 不可用 | 核实安装器版本、CLI 开关及真实可执行文件路径，再运行安装器登记 |
| 目标库路径不符 | 核实同名库与实际打开的库，修正登记后再诊断 |
| 诊断成功但扩展不连接 | 检查扩展编号、Chrome 本机登记、扩展是否加载，以及固定目录是否被移动 |
| 页面缺少企业／岗位或是列表页 | 保留未知项，手动核对预览；不猜造岗位事实 |

## 7.1 可选导入南大就业基础 Excel

用户想使用预置招聘资料时，从本版本下载页取得 `nju-employment-base-2026-10-10.xlsx` 及同名 `.sha256` 文件，或使用仓库中的 `templates/南大就业招聘基础表.xlsx`。现有 v2.0.0 ZIP 内只有空白模板，基础表作为独立附件提供；无需重新安装程序。

校验后把表放到用户自己的固定目录。先检查插件是否已配置个人 Excel 来源；更换已有来源须由用户明确指定。通过工作投递设置填写基础表的绝对路径，再点击刷新 Excel。安装本身不自动导入此表。

可以先使用 Release 程序的 `--excel <基础表实际路径>` 检查读取结果。这只是只读解析，不会导入 Obsidian；不要把其返回 JSON 覆盖到业务数据文件。实际导入使用插件的刷新 Excel 操作。

验收基线：247 条招聘会信息、219 条招聘／投递入口资料，共 466 条来源、268 家企业，初始个人岗位为 0；31 条未明确归属单一企业的来源保持未分配。已有个人数据时总数可能更多，按新增／更新结果核对，并确认备注、关注、简历和投递进度保留。

这是 2026-10-10 的共享快照，不与来源表自动同步。已清空个人状态、日期、内推码、消息编号和原始消息依据等字段；招聘计划与活动不表示用户已经投递。

## 8. 升级与卸载

升级：关闭 Obsidian，校验并解压新版 Release，使用新版包的程序和同一库路径再次运行 `--install`。保留已有数据、简历、就业笔记、设置与模板；新模板变更按版本说明单独核对，不能覆盖个人改写内容。

仅在用户要求卸载时，关闭 Obsidian 并运行：

```powershell
& $jobTool --uninstall --vault $jobVault
```

```sh
"$jobPackage/runtime/JobManager" --uninstall --vault "$jobVault"
```

卸载将本插件移入库内备份，移除匹配当前目标库的 Chrome 连接登记，保留就业数据、简历、日记、附件与系统运行副本。Chrome 扩展需在扩展管理页移除。不要删除整个 `.obsidian/`、`工作投递/` 或其他插件来完成卸载。

## 可交给朋友的 Agent 的指令

> 请先阅读这份 Agent 安装指南，为我安装 Obsidian 工作投递管理 v2.0.0 和 Chrome 岗位采集。先核实我的系统、芯片和目标库路径；使用对应 Release 安装包，保留现有库的笔记、配置和其他插件。完成安装、插件启用、扩展加载和连接诊断；真实岗位先预览，未经我授权不要添加测试投递记录。最后报告实际验证结果和仍需我操作的步骤。
