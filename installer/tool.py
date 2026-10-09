"""One bundled executable: installer, native host, Excel reader and AI importer."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'native-host'))
import setup
import host
import import_excel
import agent_import


def bundle_root():
    return Path(sys.executable).resolve().parents[1] if getattr(sys, 'frozen', False) else HERE.parent


def config_path():
    return setup.app_root() / 'runtime/config.json'


def diagnose():
    if not config_path().exists(): raise ValueError('请先运行安装入口，选择目标库。')
    config = setup.read_json(config_path())
    if not config.get('obsidianCli'): raise ValueError('未登记 Obsidian CLI。启用命令行接口后重新运行安装向导。')
    code = 'JSON.stringify({root:app.vault.adapter.basePath,enabled:!!app.plugins.plugins["keda-job-applications"],version:app.plugins.plugins["keda-job-applications"]?.manifest.version})'
    p = subprocess.run([config['obsidianCli'], 'vault=' + config['vault'], 'eval', 'code=' + code], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=20)
    if p.returncode: raise ValueError('CLI 无法执行。请检查 Obsidian 安装器版本、命令行开关及目标库是否已打开。\n' + p.stderr[-500:])
    start = p.stdout.find('{')
    try: value, _ = json.JSONDecoder().raw_decode(p.stdout[start:])
    except ValueError: raise ValueError('CLI 未返回连接状态。请打开目标库，启用命令行接口后重试。')
    if Path(value.get('root', '')).resolve() != Path(config['vaultRoot']).resolve(): raise ValueError('目标库路径不符。存在同名库时请改成唯一库名，再重新安装连接。')
    if not value.get('enabled'): raise ValueError('目标库已连接，但工作投递插件尚未启用。')
    print('Obsidian 与工作投递插件连接正常，版本：' + value.get('version','未知'))
    print('Chrome 扩展编号：' + setup.EXTENSION_ID)
    print('本机登记：' + str(setup.host_manifest_path(setup.app_root())))


def main():
    # Chrome supplies its origin as the first argument; no shell launcher required.
    if len(sys.argv) > 1 and sys.argv[1].startswith('chrome-extension://'):
        host.main(); return
    for stream in [sys.stdin, sys.stdout, sys.stderr]:
        if hasattr(stream,'reconfigure'): stream.reconfigure(encoding='utf-8')
    if len(sys.argv) > 1 and sys.argv[1] == '--excel':
        print(json.dumps(import_excel.read_excel(sys.argv[2]), ensure_ascii=False)); return
    if len(sys.argv) > 1 and sys.argv[1] == '--import':
        sys.argv.pop(1)
        config = setup.read_json(config_path())
        if '--vault' not in sys.argv: sys.argv += ['--vault', config['vault']]
        sys.argv += ['--obsidian-cli', config['obsidianCli']]
        agent_import.main(); return
    parser = argparse.ArgumentParser(description='工作投递安装向导（安装时请关闭 Obsidian）')
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--diagnose', action='store_true')
    parser.add_argument('--vault')
    parser.add_argument('--cli', default=None)
    args = parser.parse_args()
    if args.diagnose: diagnose(); return
    print('工作投递安装向导 · Windows / macOS')
    print('安装与升级只添加本模块文件；业务数据、简历及其他插件保留。')
    print('请先关闭目标 Obsidian 库。使用默认 .obsidian 配置目录；Chrome 连接到最近一次安装选择的库。')
    value = args.vault or input('已有库路径，或新库的空文件夹路径（可粘贴）：').strip().strip('"').strip("'")
    if not value: raise ValueError('没有选择库目录。')
    vault = Path(value).expanduser().resolve()
    if args.uninstall:
        print(json.dumps(setup.uninstall(vault), ensure_ascii=False, indent=2)); return
    if not vault.exists():
        if args.vault or input('目录不存在，创建为新的就业库？输入 y：').strip().lower() == 'y': vault.mkdir(parents=True)
        else: return
    cli = args.cli if args.cli is not None else setup.detect_cli()
    if not args.vault:
        print('检测到 Obsidian CLI：' + (cli or '未找到'))
        choice = input('回车使用检测结果；或粘贴 CLI 路径（未配置也能安装基础管理）：').strip().strip('"').strip("'")
        cli = choice or cli
    result = setup.install(bundle_root(), vault, cli or '')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print('安装完成：在 Obsidian 打开该库 → 设置 → 第三方插件 → 启用工作投递。')
    print('Chrome：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择上面的 extension 路径。')
    print('Chrome 采集需要 Obsidian 1.12.7+ 安装器，并启用设置 → 常规 → 命令行接口。')


if __name__ == '__main__':
    try: main()
    except Exception as e:
        if len(sys.argv) > 1 and sys.argv[1].startswith('chrome-extension://'): raise
        print('操作未完成：' + str(e), file=sys.stderr)
        sys.exit(1)
