import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('capture_host',ROOT/'native-host/host.py');host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
def frame(value):
    b=json.dumps(value,ensure_ascii=False).encode('utf-8');return struct.pack('=I',len(b))+b
class HostTests(unittest.TestCase):
    def test_protocol(self):
        v={'action':'preview','payload':{'name':'材料工程师'}}
        self.assertEqual(host.read_message(io.BytesIO(frame(v))),v)
        for bad in [b'',struct.pack('=I',0),struct.pack('=I',host.MAX_MESSAGE+1),frame(v)[:-1],frame({'action':'exec'}),frame([])]:
            with self.assertRaises(ValueError):host.read_message(io.BytesIO(bad))
        out=io.BytesIO();host.write_message(out,{'ok':True,'岗位':'研发'});self.assertEqual(json.loads(out.getvalue()[4:])['岗位'],'研发')
    def test_call_target_guard_and_temp_cleanup(self):
        calls=[];files=[]
        def run(cmd,**kwargs):
            calls.append(cmd)
            if 'pending:true' in cmd[-1]:
                # File is passed as JSON, never a shell argument or executable text.
                import re
                match=re.search(r'browserCaptureRequestFile\((".*?")\)',cmd[-1]);files.append(Path(json.loads(match[1])));self.assertTrue(files[-1].exists())
                return SimpleNamespace(returncode=0,stdout='')
            return SimpleNamespace(returncode=0,stdout='{"ok":true,"result":{"saved":true}}')
        cfg={'obsidianCli':__file__,'vault':'中文 库','vaultRoot':str(ROOT)}
        with patch.object(host.subprocess,'run',side_effect=run):
            self.assertTrue(host.call_obsidian({'action':'context'},cfg)['ok'])
        self.assertIn('目标库路径不符',calls[0][-1]);self.assertEqual(calls[0][1],'vault=中文 库');self.assertFalse(files[0].exists())
        self.assertNotIn('shell',calls[0])
    def test_bad_cli(self):
        with self.assertRaisesRegex(RuntimeError,'未找到'):host.call_obsidian({'action':'context'},{'obsidianCli':'','vault':'x'})

if __name__=='__main__':unittest.main()
