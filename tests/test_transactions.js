const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kja-browser-tests-'));
const dataPath = '工作投递/数据/工作投递数据.json';
const ob = {Plugin: class {}, ItemView: class {}, Modal: class {}, Notice: class {}};
const context = {require: name => name === 'obsidian' ? ob : require(name), module: {exports: {}}, Intl, Date, URL, Buffer, console, setTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../obsidian-plugin/main.js'), 'utf8'), context);
const Plugin = context.module.exports, {B, P} = Plugin;
function write(rel, text) { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); }
function bytes() { return fs.readFileSync(path.join(root, dataPath), 'utf8'); }
const fixture = {schema: 1, revision: 0, companies: [
  {id: 'naura', name: '北方华创（NAURA）', aliases: ['NAURA'], recordIds: [], wish: false, notes: '个人判断保留'},
  {id: 'huawei', name: '华为', aliases: [], recordIds: [], wish: false},
  {id: 'archived', name: '归档测试企业', aliases: [], recordIds: [], wish: false, archived: true, archivedAt: '2026-09-01'}
], records: [], candidateJobs: [], jobs: [{id: 'applied', companyId: 'huawei', name: '产品行销经理', batch: '2027届校招', url: 'https://example.org/jobs/101', location: '', stage: '已投递', appliedDate: '2026-09-21', resume: '工作投递/简历/历史投递简历.md', notes: '已写的个人判断', sources: []}]};
write(dataPath, JSON.stringify(fixture, null, 2) + '\n');
const backup = path.join(root, 'backup'); fs.mkdirSync(backup); fs.writeFileSync(path.join(backup, 'manifest.json'), '{"files":{}}');
const p = new Plugin(); p.roots = new Set(); p.queue = Promise.resolve(); p.settings = {backupDir: backup, undo: []}; p.manifest = {version: '1.4.0'}; p.saveData = async () => {};
p.app = {plugins: {plugins: {}}, vault: {getName: () => '隔离测试库', adapter: {basePath: root, read: async rel => fs.readFileSync(path.join(root, rel), 'utf8'), exists: async rel => fs.existsSync(path.join(root, rel))},
  getAbstractFileByPath: rel => fs.existsSync(path.join(root, rel)) ? {path: rel} : null,
  modify: async (f, text) => write(f.path, text), create: async (rel, text) => write(rel, text)}};
const input = {company: {name: '北方华创'}, name: '半导体工艺工程师', batch: '2027届校招', location: '北京', url: 'https://example.org/jobs/42?jobId=42&utm_source=wechat#detail', requirements: '材料、化学相关专业', responsibilities: '工艺开发', title: '岗位详情', evidence: '网页明确写出的岗位', notes: '本人选择理由'};
(async () => { try {
  await p.reloadData();
  assert.throws(() => B.normalize({...input, url: 'javascript:alert(1)'}), /http/);
  assert.throws(() => B.normalize({...input, url: 'https://user:password@example.org/jobs/42'}), /http/);
  assert.throws(() => B.normalize({...input, name: '校园招聘'}), /具体岗位/);
  assert.throws(() => B.normalize({...input, requirements: 'x'.repeat(12001)}), /过长/);
  assert.equal(B.preview(p.data, B.normalize(input)).companyId, 'naura');
  const before = bytes(); const first = await p.saveBrowserJob(input);
  assert.equal(first.added, 1); assert(first.undoToken); assert.equal(first.company, '北方华创（NAURA）');
  assert.equal(p.data.companies.length, 3); assert.equal(p.data.companies[0].wish, true); assert.equal(p.data.companies[0].notes, '个人判断保留');
  const j = p.data.jobs.find(j => j.id === first.jobId); assert.equal(j.stage, '待准备'); assert.equal(j.notes, input.notes); assert.equal(j.url, input.url); assert.equal(j.requirements, input.requirements);
  assert(P.filtered(p.data, '岗位').some(j => j.id === first.jobId)); assert(P.filtered(p.data, '心愿单').some(c => c.id === 'naura'));
  const saved = bytes(); const duplicate = await p.saveBrowserJob(input);
  assert.equal(duplicate.added, 0); assert.equal(duplicate.jobId, first.jobId); assert.equal(duplicate.undoToken, ''); assert.equal(bytes(), saved);
  const sameBatch = await p.saveBrowserJob({...input, batch: '2027届校园招聘计划'}); assert.equal(sameBatch.added, 0); assert.equal(sameBatch.jobId, first.jobId); assert.equal(bytes(), saved);
  await p.setJobArchived(first.jobId,true);const jobArchivedBytes=bytes();
  assert.equal(B.preview(p.data,B.normalize(input)).jobArchived,true);assert.equal(B.preview(p.data,B.normalize(input)).view,'已归档岗位');
  const archivedDuplicate=await p.saveBrowserJob(input);assert.equal(archivedDuplicate.added,0);assert.equal(archivedDuplicate.view,'已归档岗位');assert.equal(bytes(),jobArchivedBytes);
  assert.equal(p.data.jobs.find(j=>j.id===first.jobId).archived,true);assert(!P.filtered(p.data,'岗位').some(j=>j.id===first.jobId));
  await p.undo();assert.equal(bytes(),saved);
  assert.notEqual(B.batchKey('2027届秋季校招'), B.batchKey('2027届春季校招'));
  const tracking = await p.saveBrowserJob({...input, url: input.url.replace('wechat', 'chrome')});
  assert.equal(tracking.added, 0); assert.equal(p.data.jobs.length, 2); assert.equal(p.data.jobs.find(j => j.id === first.jobId).url, input.url);
  await p.undo(tracking.undoToken); assert.equal(bytes(), saved);
  await p.transact('后续独立修改', d => { d.companies[0].notes = '后来写的判断'; });
  await assert.rejects(() => p.undo(first.undoToken), /后续操作/); assert.equal(p.data.companies[0].notes, '后来写的判断');
  await p.undo(); await p.undo(first.undoToken); assert.equal(bytes(), before);
  const appliedBefore = bytes(); const applied = await p.saveBrowserJob({...input, company: {id: 'huawei', name: '华为'}, name: '产品行销经理', url: 'https://example.org/jobs/101', notes: '不得覆盖'});
  assert.equal(applied.added, 0); assert.equal(applied.view, '投递'); const old = p.data.jobs.find(j => j.id === 'applied');
  for (const key of ['stage', 'appliedDate', 'resume', 'notes']) assert.equal(old[key], fixture.jobs[0][key]);
  assert(!P.filtered(p.data, '岗位').some(j => j.id === 'applied')); await p.undo(applied.undoToken); assert.equal(bytes(), appliedBefore);
  const archiveBefore = bytes(); await assert.rejects(() => p.saveBrowserJob({...input, company: {id: 'archived', name: '归档测试企业'}}), /归档/); assert.equal(bytes(), archiveBefore);
  const restored = await p.saveBrowserJob({...input, company: {id: 'archived', name: '归档测试企业'}, restoreArchived: true});
  const c = p.data.companies.find(c => c.id === 'archived'); assert.equal(c.archived, false); assert.equal(c.wish, true); assert(!c.archivedAt);
  await p.undo(restored.undoToken); assert.equal(bytes(), archiveBefore);
  const concurrent = await Promise.all([p.saveBrowserJob(input), p.saveBrowserJob(input)]);
  assert.equal(concurrent.filter(x => x.added).length, 1); assert.equal(p.data.jobs.filter(j => j.companyId === 'naura').length, 1);
  assert.equal(concurrent.find(x => !x.added).undoToken, '');
  const missingBatch = await p.saveBrowserJob({...input, batch: ''}); assert.equal(missingBatch.added, 0);
  const differentBatch = await p.saveBrowserJob({...input, batch: '2028届校招'}); assert.equal(differentBatch.added, 1);
  const renamed = await p.saveBrowserJob({...input, name: '同一职位页面的简短名称'}); assert.equal(renamed.added, 0); assert.equal(renamed.name, input.name);
  const sharedEntry = await p.saveBrowserJob({...input, name: '材料工程师', url: 'https://example.org/campus'}); assert.equal(sharedEntry.added, 1);
  assert.equal((await p.saveBrowserJob({...input, name: '研发工程师', url: 'https://example.org/campus'})).added, 1);
  await assert.rejects(() => p.saveBrowserJob({...input, batch: ''}), /多条已有/);
  const newCompany = await p.saveBrowserJob({...input, company: {name: '明确的新企业'}, batch: ''}); assert.equal(newCompany.newCompany, true);
  const filledBatch = await p.saveBrowserJob({...input, company: {name: '明确的新企业'}, batch: '2027届校招'}); assert.equal(filledBatch.added, 0); assert.equal(p.data.jobs.find(j => j.id === newCompany.jobId).batch, '2027届校招');
  assert.equal((await p.saveBrowserJob({...input, company: {name: '明确的新企业'}, batch: '2028届校招'})).added, 1);
  const conflicting = JSON.parse(JSON.stringify(p.data)); conflicting.companies.push({id: 'another-naura', name: '其他组织', aliases: ['北方华创']});
  assert.throws(() => B.preview(conflicting, B.normalize(input)), /多条匹配/);
  const unknownIdBefore = bytes(); await assert.rejects(() => p.saveBrowserJob({...input, company: {id: 'does-not-exist', name: '北方华创'}}), /不存在/); assert.equal(bytes(), unknownIdBefore);
  console.log('浏览器岗位事务通过：自动心愿单、重复补缺、历史投递保护、不同批次、归档还原、并发去重与精确撤销。');
} finally { fs.rmSync(root, {recursive: true, force: true}); } })().catch(e => { console.error(e); process.exitCode = 1; });
