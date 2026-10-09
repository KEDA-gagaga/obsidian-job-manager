"""Allowlisted repository privacy checks; fails before publishing."""
from pathlib import Path
import json
import re
ROOT=Path(__file__).resolve().parents[1]
allowed=['obsidian-plugin','chrome-extension','native-host','installer','templates','docs','tests','scripts','.github']
errors=[]
for folder in allowed:
    for p in (ROOT/folder).rglob('*'):
        if not p.is_file() or '__pycache__' in p.parts:continue
        if p.name=='config.json':errors.append(str(p.relative_to(ROOT))+': runtime config must not be distributed')
        if p.suffix in ['.js','.mjs','.py','.md','.json','.html','.yml','.css','.txt']:
            text=p.read_text(encoding='utf-8')
            if re.search(r'/Users/[A-Za-z0-9_-]+/',text):errors.append(str(p.relative_to(ROOT))+': user-specific absolute path')
            if re.search(r'gh[pousr]_[A-Za-z0-9]{20,}',text):errors.append(str(p.relative_to(ROOT))+': credential')
            if ('KEDA' + '-实验') in text:errors.append(str(p.relative_to(ROOT))+': personal vault name')
data=json.loads((ROOT/'templates/vault/工作投递/数据/工作投递数据.json').read_text(encoding='utf-8'))
assert not any(data[k] for k in ['companies','records','jobs','candidateJobs'])
assert (ROOT/'AGENTS.md').read_bytes()==(ROOT/'CLAUDE.md').read_bytes()
if errors:raise SystemExit('\n'.join(errors))
print('PASS: only employment module, no personal paths, no credentials, empty business data')
