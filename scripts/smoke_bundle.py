"""Run the built executable and install it into an isolated existing vault."""
from pathlib import Path
import json
import subprocess
import tempfile
import sys
ROOT=Path(__file__).resolve().parents[1]
folder=next(p for p in (ROOT/'release').iterdir() if p.is_dir())
archive=folder.parent / (folder.name + '.zip')
assert archive.is_file(), 'Archive filename must retain version and platform'
assert len(list((ROOT/'release').glob('*.zip')))==1
exe=folder/'runtime'/('JobManager.exe' if sys.platform=='win32' else 'JobManager')
p=subprocess.run([str(exe),'--help'],capture_output=True,timeout=30);assert p.returncode==0,p.stderr
p=subprocess.run([str(exe),'--excel',str(folder/'templates/招聘信息模板.xlsx')],capture_output=True,timeout=30);assert p.returncode==0,p.stderr
assert json.loads(p.stdout)['companies']==[]
sys.path.insert(0,str(ROOT/'installer'));import setup
with tempfile.TemporaryDirectory() as temp:
    root=Path(temp);vault=root/'朋友 中文 库';vault.mkdir();(vault/'笔记.md').write_text('existing',encoding='utf-8')
    result=setup.install(folder,vault,app=root/'app',register=False)
    installed=Path(result['runtimeExe'])
    p=subprocess.run([str(installed),'--excel',str(folder/'templates/招聘信息模板.xlsx')],capture_output=True,timeout=30);assert p.returncode==0,p.stderr
    # Invalid caller/action must yield a framed error, never write data.
    raw=b'{"action":"exec"}';import struct
    p=subprocess.run([str(installed),'chrome-extension://'+setup.EXTENSION_ID+'/'],input=struct.pack('=I',len(raw))+raw,capture_output=True,timeout=30)
    assert p.returncode==0,p.stderr;assert json.loads(p.stdout[4:])['ok'] is False
    setup.install(folder,vault,app=root/'app',register=False)
    setup.uninstall(vault,app=root/'app',register=False)
    assert (vault/'笔记.md').read_text(encoding='utf-8')=='existing';assert (vault/'工作投递/数据/工作投递数据.json').is_file()
print('PASS: bundled executable, Excel reader, native error framing, install, upgrade and uninstall')
