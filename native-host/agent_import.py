"""Save AI-extracted facts through the running Obsidian module's reversible transaction.

Input follows 模板文件/06-企业岗位调研模板.md or 07-岗位文案与网申辅助模板.md.
Original screenshot paths must come from the user's attachments, passed as CLI arguments.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--vault', required=True)
    parser.add_argument('--kind', choices=['ai-research', 'screenshot', 'job-draft'], default='ai-research')
    parser.add_argument('--screenshot', action='append', default=[])
    parser.add_argument('--save-jobs', action='store_true', help='Only for screenshots; save identified jobs directly.')
    parser.add_argument('--obsidian-cli', default='')
    args = parser.parse_args()
    if args.save_jobs and args.kind != 'screenshot':
        parser.error('--save-jobs requires --kind screenshot; AI research candidates are selected in the view.')
    if args.kind == 'screenshot' and not args.screenshot:
        parser.error('--kind screenshot requires the original --screenshot file.')
    if args.kind == 'job-draft' and args.screenshot:
        parser.error('job-draft does not accept screenshot files.')
    payload = json.loads(Path(args.input).read_text())
    envelope = {'payload': payload, 'options': {'kind': args.kind, 'saveJobs': args.save_jobs,
                'screenshotPaths': [str(Path(p).expanduser().resolve(strict=True)) for p in args.screenshot]}}
    cli = args.obsidian_cli or shutil.which('obsidian')
    if not cli:
        raise RuntimeError('Obsidian CLI is unavailable. Enable its command-line interface and open 目标库.')
    key = '__kja_import_' + uuid.uuid4().hex
    fd, file = tempfile.mkstemp(prefix='kja-research-', suffix='.json')
    def evaluate(code):
        result = subprocess.run([cli, 'vault=' + args.vault, 'eval', 'code=' + code], text=True, capture_output=True, timeout=12)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'Obsidian eval failed.')
        return result.stdout
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(envelope, f, ensure_ascii=False)
        code = ('window[' + json.dumps(key) + ']={pending:true}; '
                '(async()=>{try{const p=app.plugins.plugins["keda-job-applications"];'
                'if(!p)throw new Error("请打开 目标库 并启用工作投递插件。");'
                'const result=await p.importResearchFile(' + json.dumps(file) + ');'
                'window[' + json.dumps(key) + ']={ok:true,result};'
                '}catch(e){window[' + json.dumps(key) + ']={ok:false,error:e.message};}})();')
        evaluate(code)
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            out = evaluate('JSON.stringify(window[' + json.dumps(key) + '])')
            prefix = out.find('{')
            if prefix >= 0:
                try:
                    receipt, _ = json.JSONDecoder().raw_decode(out[prefix:])
                except json.JSONDecodeError:
                    receipt = {'pending': True}
                if not receipt.get('pending'):
                    if not receipt.get('ok'):
                        raise RuntimeError(receipt.get('error', '导入失败。'))
                    print(json.dumps(receipt['result'], ensure_ascii=False, indent=2))
                    return
            time.sleep(0.3)
        raise RuntimeError('等待保存结果超时；请先检查工作投递视图和撤销记录，再决定是否重试。')
    finally:
        Path(file).unlink(missing_ok=True)
        try:
            evaluate('delete window[' + json.dumps(key) + ']')
        except Exception:
            pass


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        raise SystemExit(str(e))
