"""Build a self-contained archive on the target OS. Never bundle local runtime config."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--label',required=True);args=parser.parse_args()
    subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','JobManager','--paths',str(ROOT/'native-host'),'--paths',str(ROOT/'installer'),'--hidden-import','openpyxl','--distpath',str(ROOT/'dist'),'--workpath',str(ROOT/'build'),'--specpath',str(ROOT/'build'),str(ROOT/'installer/tool.py')],check=True,cwd=ROOT)
    folder=ROOT/'release'/('obsidian-job-manager-2.0.0-'+args.label)
    if folder.exists():shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for name in ['obsidian-plugin','chrome-extension','templates','docs']:
        shutil.copytree(ROOT/name,folder/name)
    shutil.copytree(ROOT/'dist/JobManager',folder/'runtime')
    shutil.copy2(ROOT/'README.md',folder/'请先阅读.md')
    if sys.platform=='win32':
        for name,flag in [('安装','--install'),('检查连接','--diagnose'),('卸载','--uninstall')]:
            (folder/(name+'.cmd')).write_bytes(('@echo off\r\nchcp 65001 >nul\r\n"%~dp0runtime\\JobManager.exe" '+flag+'\r\npause\r\n').encode('utf-8'))
    else:
        for name,flag in [('安装','--install'),('检查连接','--diagnose'),('卸载','--uninstall')]:
            p=folder/(name+'.command');p.write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\n./runtime/JobManager '+flag+'\nprintf "\\n按回车关闭…"\nread answer\n');p.chmod(0o755)
    metadata={'version':'2.0.0','platform':sys.platform,'architecture':platform.machine(),'nativeDesktopEndToEnd':'not-verified','buildRuntime':'self-contained'}
    (folder/'build-info.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
    archive=folder.parent / (folder.name + '.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(folder.rglob('*')):
            if p.is_file():z.write(p,p.relative_to(folder.parent))
    checksum=archive.with_suffix('.zip.sha256');checksum.write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
    print(archive)

if __name__=='__main__':main()
