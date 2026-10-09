"""Chrome Native Messaging host; routes fixed requests to the Obsidian module."""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
CONFIG = ROOT / 'config.json'
ACTIONS = {'context', 'preview', 'save', 'undo', 'open'}
MAX_MESSAGE = 128 * 1024


def read_exact(stream, count):
    parts = bytearray()
    while len(parts) < count:
        chunk = stream.read(count - len(parts))
        if not chunk:
            raise ValueError('消息不完整，请重新打开扩展。')
        parts.extend(chunk)
    return bytes(parts)


def read_message(stream):
    size = struct.unpack('=I', read_exact(stream, 4))[0]
    if size > MAX_MESSAGE or size == 0:
        raise ValueError('岗位信息过长，请精简后保存。')
    request = json.loads(read_exact(stream, size).decode('utf-8'))
    if not isinstance(request, dict) or request.get('action') not in ACTIONS:
        raise ValueError('不支持的岗位采集操作。')
    return request


def write_message(stream, value):
    body = json.dumps(value, ensure_ascii=False).encode('utf-8')
    stream.write(struct.pack('=I', len(body)))
    stream.write(body)
    stream.flush()


def call_obsidian(request, config):
    cli = config.get('obsidianCli', '')
    if not cli or not Path(cli).is_file():
        raise RuntimeError('未找到 Obsidian 命令行，请核对模块规则中的定位。')
    key = '__kja_browser_' + uuid.uuid4().hex
    fd, file = tempfile.mkstemp(prefix='kja-browser-', suffix='.json')

    def evaluate(code):
        proc = subprocess.run([cli, 'vault=' + config['vault'], 'eval', 'code=' + code], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=12, **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}))
        if proc.returncode:
            raise RuntimeError('无法连接 Obsidian，请检查目标库已打开且工作投递插件已启用。')
        return proc.stdout

    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(request, stream, ensure_ascii=False)
        evaluate('window[' + json.dumps(key) + ']={pending:true};'
                 '(async()=>{try{if(app.vault.adapter.basePath.replace(/\\\\/g,"/").toLowerCase()!=='+json.dumps(config['vaultRoot'].replace('\\','/').lower())+')throw new Error("目标库路径不符，请重新安装连接。");const p=app.plugins.plugins["keda-job-applications"];'
                 'if(!p?.browserCaptureRequestFile)throw new Error("请启用最新版工作投递模块。");'
                 'const result=await p.browserCaptureRequestFile(' + json.dumps(file) + ');'
                 'window[' + json.dumps(key) + ']={ok:true,result};'
                 '}catch(e){window[' + json.dumps(key) + ']={ok:false,error:e.message};}})();')
        deadline = time.monotonic() + 38
        while time.monotonic() < deadline:
            out = evaluate('JSON.stringify(window[' + json.dumps(key) + '])')
            start = out.find('{')
            if start >= 0:
                try:
                    receipt, _ = json.JSONDecoder().raw_decode(out[start:])
                except ValueError:
                    receipt = {'pending': True}
                if not receipt.get('pending'):
                    return receipt
            time.sleep(0.2)
        raise RuntimeError('等待保存结果超时。请先到 Obsidian 检查岗位和撤销记录，再重试。')
    finally:
        Path(file).unlink(missing_ok=True)
        try:
            evaluate('delete window[' + json.dumps(key) + ']')
        except Exception:
            pass


def main():
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
            msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
        config = json.loads(CONFIG.read_text(encoding='utf-8'))
        expected = 'chrome-extension://' + config['extensionId'] + '/'
        if len(sys.argv) < 2 or sys.argv[1] != expected:
            raise ValueError('调用方不是已登记的岗位采集扩展。')
        response = call_obsidian(read_message(sys.stdin.buffer), config)
    except Exception as error:
        response = {'ok': False, 'error': str(error)}
    write_message(sys.stdout.buffer, response)


if __name__ == '__main__':
    main()
