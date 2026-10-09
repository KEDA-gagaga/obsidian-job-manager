# Obsidian 工作投递管理

独立的就业管理插件和 Chrome 岗位采集。支持企业、心愿单、岗位、投递、备注、置顶、归档、简历绑定和撤销。仅包含就业功能，不包含任何个人求职数据。

## 下载与安装

在本仓库 Releases 下载对应系统的 ZIP，解压到固定位置（Chrome 后续仍会读取扩展目录）：

- Windows 64 位：windows-x64；双击 `安装.cmd`。
- Apple 芯片 Mac：macos-arm64；双击 `安装.command`。
- Intel Mac：macos-x64；双击 `安装.command`。

安装器未做系统代码签名；Windows 或 macOS 可能提示来源未验证。确认文件来自本仓库后按系统提示打开，不关闭系统全局安全保护。Mac 若无法双击，可以在终端执行 `bash 安装.command`；程序自身若被系统拦截，需在系统设置允许该程序。

1. 关闭 Obsidian。运行安装入口，粘贴已有库路径，或选择一个新空目录建立就业库。
2. 在 Obsidian 打开目标库；设置 → 第三方插件，启用「工作投递」。点击左侧公文包进入。
3. Chrome 打开 `chrome://extensions`，启用开发者模式，加载解压包内的 `chrome-extension/` 文件夹。
4. Chrome 采集需要 Obsidian **1.12.7+ 安装器**，在设置 → 常规启用命令行接口。运行 `检查连接` 入口。
5. 打开具体岗位网页 → 扩展图标 → 核对预览 → 保存到岗位。

基础管理不需要 Python、Node、Codex、外部 AI、Excel 或其他 Obsidian 插件。连接程序与 Excel 读取运行环境已经包含在下载包。Chrome 采集需要目标库正在运行。

官方说明：[Obsidian CLI](https://obsidian.md/help/cli)、[Chrome 本机消息通信](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。

## 兼容已有库

- 使用默认 `.obsidian/` 配置目录。自定义配置目录本版暂不支持，请使用专用库。
- 不修改已有库的主页、日记设置、插件启用列表、全局规则或其他插件。
- 本模块数据集中在 `工作投递/`。已有同名目录或非本发行版的同名插件会停止安装，避免覆盖。
- 升级前关闭 Obsidian，再运行新版安装入口；保留业务数据、简历、就业日记、附件、模板、设置和撤销记录。
- 路径迁移或换电脑后重新运行安装器。Chrome 当前只连接最近一次安装选中的库；同名库请改成唯一名称。
- Obsidian Sync 或 iCloud 不会同步系统中的本机连接登记，每台电脑需单独安装对应系统包。

## Excel、简历与 AI

Excel 为可选入口，空白模板在 `templates/招聘信息模板.xlsx`。兼容 `投递信息` 和 `招聘会信息` 工作表，至少需要「企业」「记录ID」列。设置填写绝对路径；关闭 Excel 后刷新，原文件只读。

基础简历在 `工作投递/简历/基础工作简历-纯文本版.md`；也可在岗位中绑定已有简历笔记。AI 按钮只生成待执行任务，需由自己的 AI 工具执行，模板在 `工作投递/模板/`；不会自动发送简历或购买 AI 服务。

## 卸载

关闭 Obsidian，运行卸载入口，输入目标库路径。插件移动到 `.obsidian/job-manager-backups/uninstalled/`；就业数据、简历、日记、截图保留，其他插件不动。Chrome 扩展在扩展管理页移除。系统运行环境保留便于重装，Chrome 对应连接登记会按当前目标库匹配移除。

## 验证范围

自动验证包括三平台构建、打包程序启动、安装／升级／卸载数据保护、核心业务与扩展逻辑。本版尚未对 Windows 和两种 Mac 的真实桌面执行完整 Chrome → Obsidian 人工验收；构建通过不代表所有网页能自动识别，采集前须核对预览。

## 开发

Python 3.12、Node 22。安装 `requirements.txt` 后运行 `python -m unittest discover -s tests -p "test_*.py" -v` 和 tests 下的 JS/MJS 检查。推送版本标签会在 GitHub Actions 分别构建本机运行环境，并上传 Release 安装包。
