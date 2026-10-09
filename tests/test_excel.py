import importlib.util
from pathlib import Path
import tempfile
import unittest
import openpyxl
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('excel_reader',ROOT/'native-host/import_excel.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
class ExcelTests(unittest.TestCase):
    def test_template_empty_and_source_unchanged(self):
        p=ROOT/'templates/招聘信息模板.xlsx';before=p.read_bytes();result=reader.read_excel(p)
        self.assertEqual(result['companies'],[]);self.assertEqual(result['initialJobs'],[]);self.assertEqual(before,p.read_bytes())
    def test_personal_workbook_no_forced_batch(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'朋友 表格.xlsx';w=openpyxl.Workbook();s=w.active;s.title='投递信息'
            s.append(['记录ID','企业','招聘计划/岗位','我的投递状态','我的投递日期','投递入口']);s.append(['r1','示例企业','工程师','已投递','2026-10-09','https://example.org/jobs']);w.save(p)
            result=reader.read_excel(p)
            self.assertEqual(result['initialJobs'][0]['batch'],'')
            self.assertEqual(result['initialJobs'][0]['url'],'https://example.org/jobs')
            (p.parent/('~$'+p.name)).touch()
            with self.assertRaisesRegex(RuntimeError,'正在编辑'):reader.read_excel(p)
if __name__=='__main__':unittest.main()
