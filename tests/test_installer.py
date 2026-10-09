import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('job_setup',ROOT/'installer/setup.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)

class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.vault=root/'中文 朋友 库';self.vault.mkdir()
        self.app=root/'app';self.bundle=root/'bundle';self.bundle.mkdir()
        for name in ['obsidian-plugin','templates']:shutil.copytree(ROOT/name,self.bundle/name)
        runtime=self.bundle/'runtime';runtime.mkdir()
        self.exe='JobManager.exe' if setup.os.name=='nt' else 'JobManager'
        (runtime/self.exe).write_bytes(b'test executable')
    def install(self):return setup.install(self.bundle,self.vault,app=self.app,register=False)
    def test_upgrade_preserves_existing_vault(self):
        old=self.vault/'.obsidian/plugins/another';old.mkdir(parents=True)
        (old/'data.json').write_bytes(b'{"keep":true}')
        enabled=self.vault/'.obsidian/community-plugins.json';enabled.write_bytes(b'["another"]')
        workspace=self.vault/'.obsidian/workspace.json';workspace.write_bytes(b'{"layout":"keep"}')
        daily=self.vault/'日记/2026-10-09.md';daily.parent.mkdir();daily.write_text('现有日记',encoding='utf-8')
        self.install()
        data=self.vault/'工作投递/数据/工作投递数据.json'
        d=setup.read_json(data);d['companies']=[{'id':'c','name':'朋友企业','wish':True,'notes':'个人备注'}];d['jobs']=[{'id':'j','companyId':'c','name':'岗位','stage':'面试','resume':'我的简历.md'}]
        data.write_bytes(setup.json_bytes(d));before=data.read_bytes()
        resume=self.vault/'工作投递/简历/基础工作简历-纯文本版.md';resume.write_text('朋友自己的简历',encoding='utf-8')
        config=self.vault/'.obsidian/plugins/keda-job-applications/data.json';settings=setup.read_json(config);settings['excel']='C:/中文 目录/source.xlsx';settings['undo']=['history'];config.write_bytes(setup.json_bytes(settings))
        result=self.install()
        self.assertEqual(data.read_bytes(),before);self.assertEqual(resume.read_text(encoding='utf-8'),'朋友自己的简历')
        self.assertEqual(setup.read_json(config)['undo'],['history']);self.assertEqual(setup.read_json(config)['excel'],settings['excel'])
        self.assertEqual(enabled.read_bytes(),b'["another"]');self.assertEqual(workspace.read_bytes(),b'{"layout":"keep"}');self.assertEqual(daily.read_text(encoding='utf-8'),'现有日记')
        self.assertTrue(Path(result['backup']).is_dir())
        enabled.write_bytes(setup.json_bytes(['another',setup.PLUGIN_ID]))
        removed=setup.uninstall(self.vault,app=self.app,register=False)
        self.assertEqual(setup.read_json(enabled),['another']);self.assertEqual(data.read_bytes(),before);self.assertTrue(old.exists());self.assertTrue(Path(removed['pluginBackup']).exists())
    def test_collision_has_no_mutation(self):
        folder=self.vault/'工作投递';folder.mkdir();(folder/'个人笔记.md').write_text('keep')
        with self.assertRaisesRegex(ValueError,'没有本发行版'):self.install()
        self.assertFalse((self.vault/'.obsidian').exists());self.assertFalse(self.app.exists())
    def test_foreign_plugin_has_no_mutation(self):
        folder=self.vault/'.obsidian/plugins/keda-job-applications';folder.mkdir(parents=True);(folder/'main.js').write_text('foreign')
        with self.assertRaisesRegex(ValueError,'已有同名插件'):self.install()
        self.assertEqual((folder/'main.js').read_text(),'foreign');self.assertFalse(self.app.exists())
    def test_malformed_data_refuses_upgrade(self):
        self.install();data=self.vault/'工作投递/数据/工作投递数据.json';data.write_text('{broken')
        settings=self.vault/'.obsidian/plugins/keda-job-applications/data.json';before=settings.read_bytes()
        with self.assertRaises(json.JSONDecodeError):self.install()
        self.assertEqual(settings.read_bytes(),before)
    def test_symbolic_link_refused(self):
        if setup.os.name=='nt':self.skipTest('Windows symlink requires extra rights')
        target=Path(self.temp.name)/'external';target.mkdir();(self.vault/'工作投递').symlink_to(target,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'符号链接'):self.install()
        self.assertEqual(list(target.iterdir()),[])

if __name__=='__main__':unittest.main()
