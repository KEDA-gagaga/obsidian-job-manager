const assert = require('node:assert/strict');
const {P} = require('../obsidian-plugin/main.js');
const source = {sourceHash:'a', companies:[{id:'c',name:'企业',aliases:['企业'],recordIds:['r']}], records:[{id:'r',companyId:'c',links:{'投递入口':'https://example.org/jobs'},fields:{}}],initialJobs:[{id:'j',companyId:'c',name:'岗位',stage:'已投递',appliedDate:'2026-09-21'}]};
let d = P.merge(null, source); d.companies[0].wish = true; d.companies[0].notes = '我的判断'; d.jobs[0].stage='面试'; d.jobs[0].resume='实际简历.md';
const refreshed = P.merge(d, {...source,sourceHash:'b', records:[{...source.records[0],fields:{'工作地点':'南京'}}]});
assert.equal(refreshed.companies.length,1);assert.equal(refreshed.records.length,1);assert.equal(refreshed.jobs.length,1);
assert.equal(refreshed.companies[0].wish,true);assert.equal(refreshed.companies[0].notes,'我的判断');assert.equal(refreshed.jobs[0].stage,'面试');assert.equal(refreshed.jobs[0].resume,'实际简历.md');
assert.equal(P.merge(refreshed,{...source,companies:[],records:[],initialJobs:[]}).jobs.length,1);
assert.equal(P.filtered(refreshed,'企业','南京').length,0);
assert.equal(P.filtered(refreshed,'心愿单','南京').length,1);
assert.equal(P.filtered(refreshed,'心愿单').length,1);assert.equal(P.filtered(refreshed,'企业','企业').length,0);assert.equal(P.filtered(refreshed,'投递','','进行中').length,1);
assert.equal(P.filtered(refreshed,'岗位').length,0);
const pipeline = {...refreshed, companies:[...refreshed.companies,{id:'outside',name:'未关注企业',wish:false}], jobs:[...refreshed.jobs,
  {id:'p1',companyId:'c',name:'具体岗位一',stage:'待准备',appliedDate:''},
  {id:'p2',companyId:'c',name:'具体岗位二',stage:'待投递',appliedDate:''},
  {id:'p3',companyId:'outside',name:'未关注岗位',stage:'待准备',appliedDate:''},
  {id:'p4',companyId:'c',name:'有实际投递日期',stage:'待准备',appliedDate:'2026-10-05'},
  {id:'p5',companyId:'c',name:'已结束投递',stage:'未通过',appliedDate:'2026-10-04'}]};
assert.deepEqual(new Set(P.filtered(pipeline,'岗位').map(j=>j.id)),new Set(['p1','p2']));
assert.deepEqual(P.filtered(pipeline,'岗位','','待投递').map(j=>j.id),['p2']);
const pinnedPipeline=JSON.parse(JSON.stringify(pipeline));
pinnedPipeline.jobs.find(j=>j.id==='p2').pinned=true;pinnedPipeline.jobs.find(j=>j.id==='p2').pinnedAt='2026-10-07T01:00:00.000Z';
const pinSnapshot=JSON.stringify(pinnedPipeline);assert.deepEqual(P.filtered(pinnedPipeline,'岗位').map(j=>j.id),['p2','p1']);assert.equal(JSON.stringify(pinnedPipeline),pinSnapshot);
pinnedPipeline.jobs.find(j=>j.id==='p1').pinned=true;pinnedPipeline.jobs.find(j=>j.id==='p1').pinnedAt='2026-10-07T02:00:00.000Z';
assert.deepEqual(P.filtered(pinnedPipeline,'岗位','具体岗位').map(j=>j.id),['p1','p2']);
assert.deepEqual(P.filtered(pinnedPipeline,'岗位','','待投递').map(j=>j.id),['p2']);
assert.equal(P.merge(pinnedPipeline,source).jobs.find(j=>j.id==='p1').pinned,true);
pinnedPipeline.jobs.find(j=>j.id==='p1').pinned=false;
assert.deepEqual(P.filtered(pinnedPipeline,'岗位').map(j=>j.id),['p2','p1']);
assert.deepEqual(P.filtered(pinnedPipeline,'投递').map(j=>j.id),P.filtered(pipeline,'投递').map(j=>j.id));
assert.deepEqual(new Set(P.filtered(pipeline,'投递').map(j=>j.id)),new Set(['j','p4','p5']));
assert.deepEqual(new Set(P.filtered(pipeline,'投递','','进行中').map(j=>j.id)),new Set(['j','p4']));
assert.deepEqual(P.filtered(pipeline,'企业').map(c=>c.id),['outside']);
assert.deepEqual(P.filtered(pipeline,'心愿单').map(c=>c.id),['c']);
const selection=JSON.parse(JSON.stringify(pipeline)), retained=JSON.stringify(selection.jobs);
selection.companies[0].wish=false;
assert.equal(P.filtered(selection,'企业','南京','有投递入口').length,1);
assert.equal(P.filtered(selection,'心愿单').length,0);
selection.companies[0].wish=true;
assert.equal(P.filtered(selection,'企业','南京','有投递入口').length,0);
assert.equal(P.filtered(selection,'心愿单','南京').length,1);
assert.equal(JSON.stringify(selection.jobs),retained);
assert.equal(P.filtered({...selection,companies:[{id:'legacy',name:'未设置关注值'}]},'企业').length,1);
const archivedPipeline=JSON.parse(JSON.stringify(pipeline)), retainedJobs=JSON.stringify(pipeline.jobs);
archivedPipeline.companies.forEach(c=>{c.archived=true;c.archivedAt='2026-10-07'});
assert.equal(P.filtered(archivedPipeline,'企业').length,0);
assert.equal(P.filtered(archivedPipeline,'心愿单').length,0);
assert.equal(P.filtered(archivedPipeline,'岗位').length,0);
assert.equal(P.filtered(archivedPipeline,'已归档','南京').length,1);
assert.equal(P.filtered(archivedPipeline,'已归档').length,2);
assert.deepEqual(P.filtered(archivedPipeline,'投递').map(j=>j.id),P.filtered(pipeline,'投递').map(j=>j.id));
const mergedArchive=P.merge(archivedPipeline,source);
assert.equal(mergedArchive.companies.find(c=>c.id==='c').archived,true);
assert.equal(mergedArchive.companies.find(c=>c.id==='c').archivedAt,'2026-10-07');
archivedPipeline.companies.forEach(c=>{c.archived=false});
assert.deepEqual(P.filtered(archivedPipeline,'企业').map(c=>c.id),['outside']);
assert.deepEqual(P.filtered(archivedPipeline,'心愿单').map(c=>c.id),['c']);
assert.deepEqual(P.filtered(archivedPipeline,'岗位').map(j=>j.id),P.filtered(pipeline,'岗位').map(j=>j.id));
assert.equal(JSON.stringify(archivedPipeline.jobs),retainedJobs);
const archivedJobs=JSON.parse(JSON.stringify(pinnedPipeline)),beforeJobArchive=JSON.stringify(archivedJobs);
const archivedPending=archivedJobs.jobs.find(j=>j.id==='p1');archivedPending.archived=true;archivedPending.archivedAt='2026-10-08';
const archivedApplied=archivedJobs.jobs.find(P.isApplied);archivedApplied.archived=true;archivedApplied.archivedAt='2026-10-07';
assert(!P.filtered(archivedJobs,'岗位').some(j=>j.id===archivedPending.id));
assert(!P.filtered(archivedJobs,'投递').some(j=>j.id===archivedApplied.id));
assert.deepEqual(P.filtered(archivedJobs,'已归档岗位').map(j=>j.id),[archivedPending.id,archivedApplied.id]);
assert.deepEqual(P.filtered(archivedJobs,'已归档岗位','','未投递').map(j=>j.id),[archivedPending.id]);
assert.deepEqual(P.filtered(archivedJobs,'已归档岗位','','已投递').map(j=>j.id),[archivedApplied.id]);
assert.equal(P.filtered(archivedJobs,'已归档岗位',archivedPending.name).length,1);
assert.equal(P.jobTab(archivedApplied),'已归档岗位');
assert.equal(P.companyProgress(archivedJobs,'c').total,P.companyProgress(pinnedPipeline,'c').total-2);
const importedArchived=P.merge(archivedJobs,source);assert.equal(importedArchived.jobs.find(j=>j.id===archivedPending.id).archived,true);
assert.equal(importedArchived.jobs.find(j=>j.id===archivedPending.id).archivedAt,'2026-10-08');
archivedJobs.companies.forEach(c=>{c.archived=true;c.wish=false});
assert.equal(P.filtered(archivedJobs,'已归档岗位').length,2);
assert.equal(P.filtered(pinnedPipeline,'已归档岗位').length,0);
assert.equal(JSON.stringify(pinnedPipeline),beforeJobArchive);
assert.deepEqual(P.companyProgress(pipeline,'c'),{total:5,pending:2,applied:3});
assert.deepEqual(P.companyProgress(pipeline,'missing'),{total:0,pending:0,applied:0});
const progressData={companies:[{id:'none',name:'仅有候选',wish:true},{id:'pending',name:'已添加',wish:true},{id:'applied',name:'历史投递',wish:true},{id:'mixed',name:'同时准备及投递',wish:true},{id:'hidden',name:'未关注',wish:false}],records:[],candidateJobs:[{companyId:'none',name:'候选岗位'}],jobs:[
 {companyId:'pending',stage:'待准备',appliedDate:''},
 {companyId:'applied',stage:'未通过',appliedDate:'2026-10-05'},
 {companyId:'mixed',stage:'待投递',appliedDate:''},
 {companyId:'mixed',stage:'待准备',appliedDate:'2026-10-05'},
 {companyId:'hidden',stage:'已投递',appliedDate:'2026-10-05'}]};
const progressBefore=JSON.stringify(progressData);
assert.deepEqual(P.filtered(progressData,'心愿单','','未添加岗位').map(c=>c.id),['none']);
assert.deepEqual(new Set(P.filtered(progressData,'心愿单','','已添加岗位').map(c=>c.id)),new Set(['pending','applied','mixed']));
assert.deepEqual(new Set(P.filtered(progressData,'心愿单','','已投递').map(c=>c.id)),new Set(['applied','mixed']));
assert.equal(P.filtered(progressData,'心愿单','历史','已投递').length,1);
assert.deepEqual(P.companyProgress(progressData,'mixed'),{total:2,pending:1,applied:1});
assert.equal(JSON.stringify(progressData),progressBefore);
progressData.jobs.push({companyId:'none',stage:'待准备',appliedDate:''});
assert.equal(P.filtered(progressData,'心愿单','','未添加岗位').length,0);
assert.equal(P.filtered(progressData,'心愿单','','已添加岗位').length,4);
assert.equal(P.safeUrl('javascript:alert(1)'),'');assert.equal(P.safeUrl('https://example.org/?job=1'),'https://example.org/?job=1');
const diary='---\n日期: 2026-10-05\n---\n\n## 主线\n\n### [[其他主题]]\n原文\n\n## 随记\n随记原文\n\n## 复盘\n复盘原文\n';
const a=P.insertDiary(diary,'- [ ] 第一个动作 #AI');const b=P.insertDiary(a,'- 反馈事实');
assert.equal((b.match(/### 💼 \[\[工作投递管理系统\]\]/g)||[]).length,1);assert(b.includes('原文'));assert(b.includes('随记原文'));assert(b.indexOf('- 反馈事实')<b.indexOf('## 随记'));
console.log('PASS: repeated import, personal-field preservation, source retention, filtering, link safety, diary boundaries');
assert.equal(P.draftText('---\n所在文件夹:\n---\n\n# 可直接使用的文案\n\n正文第一行\n第二行\n\n# 事实依据与调整\n内部说明'),'正文第一行\n第二行');
assert.equal(P.draftText('# 可直接使用的文案\n末尾文案'),'末尾文案');
assert.equal(P.draftText('# 其他内容\n没有可复制文案'),'');
