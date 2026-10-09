"""Install only owned files. Existing vault data and unrelated settings are preserved."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

PLUGIN_ID = 'keda-job-applications'
HOST_NAME = 'kg.keda.job_capture'
EXTENSION_ID = 'jhpejkfkpahkflhdpbmkbkkjaakkamoo'

def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.job-manager-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data if isinstance(data, bytes) else data.encode('utf-8'))
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')

def app_root():
    if os.name == 'nt':
        return Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData/Local'))) / 'ObsidianJobManager'
    return Path.home() / 'Library/Application Support/ObsidianJobManager'

def host_manifest_path(app):
    if os.name == 'nt':
        return app / (HOST_NAME + '.json')
    return Path.home() / 'Library/Application Support/Google/Chrome/NativeMessagingHosts' / (HOST_NAME + '.json')

def detect_cli():
    candidates = [shutil.which('obsidian')]
    if os.name == 'nt':
        candidates += [str(Path(os.environ.get('LOCALAPPDATA', '')) / 'Obsidian/Obsidian.com'), str(Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Obsidian/Obsidian.com')]
    else:
        candidates += ['/Applications/Obsidian.app/Contents/MacOS/obsidian', str(Path.home() / 'Applications/Obsidian.app/Contents/MacOS/obsidian')]
    return next((p for p in candidates if p and Path(p).is_file()), '')

def validate_vault(vault):
    if not vault.is_dir():
        raise ValueError('库目录不存在。新库请先创建一个空文件夹。')
    # Respect Obsidian custom configuration directory. Do not accidentally install to a different one.
    if (vault / '.obsidian').is_symlink() or (vault / '工作投递').is_symlink():
        raise ValueError('目标目录使用符号链接，请选择实际库目录。')
    for p in [vault / '.obsidian', vault / '工作投递']:
        if p.exists() and not p.is_dir():
            raise ValueError('路径已由其他文件占用：' + str(p))

def install(bundle, vault, cli='', app=None, register=True):
    bundle, vault = Path(bundle).resolve(), Path(vault).resolve()
    app = Path(app) if app else app_root()
    validate_vault(vault)
    plugin = vault / '.obsidian/plugins' / PLUGIN_ID
    receipt = plugin / 'job-manager-install.json'
    if plugin.exists():
        if not receipt.is_file() or read_json(receipt).get('product') != 'obsidian-job-manager':
            raise ValueError('已有同名插件并非本发行版安装。未覆盖；请使用其他库，或先备份并移除旧插件。')
    if (vault / '工作投递').exists() and not receipt.is_file():
        raise ValueError('工作投递目录已存在且没有本发行版登记。未覆盖，请换库或先处理同名目录。')
    settings_path = plugin / 'data.json'
    settings = read_json(settings_path) if settings_path.exists() else {}
    if not isinstance(settings, dict):
        raise ValueError('已有插件设置格式异常，未覆盖。')
    baseline = vault / '.obsidian/job-manager-backups/manifest.json'
    data_file = vault / '工作投递/数据/工作投递数据.json'
    if data_file.exists():
        d = read_json(data_file)
        if d.get('schema') != 1 or not all(isinstance(d.get(k), list) for k in ['companies', 'records', 'jobs']):
            raise ValueError('已有就业数据不受支持，未覆盖。')
    if baseline.exists() and not isinstance(read_json(baseline).get('files'), dict):
        raise ValueError('已有撤销基线格式异常，未覆盖。')
    # All paths and formats are checked before the first mutation.
    for p in plugin.parents:
        if p == vault.parent: break
        if p.is_symlink(): raise ValueError('插件目录含符号链接，未安装。')
    for p in list((bundle / 'obsidian-plugin').iterdir()) + list((bundle / 'templates/vault').rglob('*')):
        if p.is_file():
            rel = p.relative_to(bundle / 'templates/vault') if 'templates/vault' in p.as_posix() else None
            target = vault / rel if rel else plugin / p.name
            if target.is_symlink(): raise ValueError('目标文件为符号链接，未覆盖：' + str(target))
    old_host = host_manifest_path(app)
    if register and old_host.exists():
        old = read_json(old_host)
        if old.get('path') != str(app / 'runtime' / ('JobManager.exe' if os.name == 'nt' else 'JobManager')):
            raise ValueError('已有其他版本的 Chrome 本机连接，未覆盖。请先移除其登记。')
    runtime_source = bundle / 'runtime'
    executable_name = 'JobManager.exe' if os.name == 'nt' else 'JobManager'
    if not (runtime_source / executable_name).is_file():
        raise ValueError('缺少本系统的运行环境，请下载对应系统的 Release 安装包。')
    if cli and not Path(cli).is_file(): raise ValueError('选择的 Obsidian 命令行程序不存在。')
    # Backup only owned plugin files and business data, never the whole vault.
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = vault / '.obsidian/job-manager-backups/installations' / stamp
    if plugin.exists():
        shutil.copytree(plugin, backup / 'plugin')
        if data_file.exists(): shutil.copy2(data_file, backup / '工作投递数据.json')
    app.mkdir(parents=True, exist_ok=True)
    staged = app / ('runtime-new-' + stamp)
    shutil.copytree(runtime_source, staged)
    runtime = app / 'runtime'
    previous = app / ('runtime-old-' + stamp)
    if runtime.exists(): runtime.rename(previous)
    try:
        staged.rename(runtime)
    except Exception:
        if previous.exists(): previous.rename(runtime)
        raise
    exe = runtime / executable_name
    if os.name != 'nt': exe.chmod(0o755)
    config = {'extensionId':EXTENSION_ID, 'hostName':HOST_NAME, 'vault':vault.name, 'vaultRoot':vault.as_posix(), 'obsidianCli':cli}
    atomic_write(runtime / 'config.json', json_bytes(config))
    if os.name != 'nt': (runtime / 'config.json').chmod(0o600)
    settings.update({'runtimeExe':str(exe), 'backupDir':str(vault / '.obsidian/job-manager-backups')})
    for p in (bundle / 'obsidian-plugin').iterdir():
        if p.is_file(): atomic_write(plugin / p.name, p.read_bytes())
    # Existing notes, resume, data, templates and AI results are never overwritten.
    for p in (bundle / 'templates/vault').rglob('*'):
        if p.is_file():
            target = vault / p.relative_to(bundle / 'templates/vault')
            if not target.exists(): atomic_write(target, p.read_bytes())
    for rel in ['工作投递/日记','工作投递/附件','工作投递/AI结果','工作投递/简历']:
        (vault / rel).mkdir(parents=True, exist_ok=True)
    if not baseline.exists(): atomic_write(baseline, json_bytes({'files':{}}))
    atomic_write(settings_path, json_bytes(settings))
    atomic_write(receipt, json_bytes({'product':'obsidian-job-manager','version':'2.0.0','installedAt':stamp,'backup':str(backup) if backup.exists() else ''}))
    # Do not modify community-plugins.json, workspace or restricted mode: enable in Obsidian UI.
    if register:
        manifest = {'name':HOST_NAME,'description':'Obsidian 工作投递岗位采集','path':str(exe),'type':'stdio','allowed_origins':['chrome-extension://' + EXTENSION_ID + '/']}
        atomic_write(old_host, json_bytes(manifest))
        if os.name == 'nt':
            import winreg
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Google\Chrome\NativeMessagingHosts' + chr(92) + HOST_NAME) as key:
                winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(old_host))
    if previous.exists(): shutil.rmtree(previous)
    return {'vault':str(vault), 'runtimeExe':str(exe), 'extension':str(bundle/'chrome-extension'), 'backup':str(backup) if backup.exists() else None}

def uninstall(vault, app=None, register=True):
    vault = Path(vault).resolve(); app = Path(app) if app else app_root()
    plugin = vault / '.obsidian/plugins' / PLUGIN_ID
    receipt = plugin / 'job-manager-install.json'
    if not receipt.is_file() or read_json(receipt).get('product') != 'obsidian-job-manager':
        raise ValueError('没有本发行版的安装登记；未删除任何文件。')
    backup = vault / '.obsidian/job-manager-backups/uninstalled' / dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.parent.mkdir(parents=True, exist_ok=True)
    # Disable only this plugin; keep every other enabled plugin entry and setting.
    enabled = vault / '.obsidian/community-plugins.json'
    if enabled.exists():
        values = read_json(enabled)
        if not isinstance(values, list): raise ValueError('第三方插件配置异常，未卸载。')
        if PLUGIN_ID in values: atomic_write(enabled, json_bytes([v for v in values if v != PLUGIN_ID]))
    shutil.move(str(plugin), str(backup))
    config_file = app / 'runtime/config.json'
    if register and config_file.exists() and read_json(config_file).get('vaultRoot') == vault.as_posix():
        host_file = host_manifest_path(app)
        expected = str(app / 'runtime' / ('JobManager.exe' if os.name == 'nt' else 'JobManager'))
        if host_file.exists() and read_json(host_file).get('path') == expected:
            if os.name == 'nt':
                import winreg
                key_path = r'Software\Google\Chrome\NativeMessagingHosts' + chr(92) + HOST_NAME
                try:
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                        registered = winreg.QueryValueEx(key, '')[0]
                    if registered == str(host_file): winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_path)
                except FileNotFoundError: pass
            host_file.unlink()
    return {'preservedData':str(vault/'工作投递'), 'pluginBackup':str(backup)}
