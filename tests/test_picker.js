/* The real picker logic runs against an isolated DOM substitute, without opening user UI. */
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
class El {
  constructor(tag='div',options={}){this.tag=tag;this.options=options;this.children=[];this.value=options.value||'';this.textContent=options.text||'';this.disabled=false;this.checked=false;}
  createEl(tag,o={}){const el=new El(tag,o);this.children.push(el);return el;}
  createDiv(o={}){return this.createEl('div',o);}createSpan(o={}){return this.createEl('span',o);}
  setText(text){this.textContent=text;}addClass(){}toggleClass(){}empty(){this.children=[];}focus(){}
  find(predicate){return [this,...this.children.flatMap(x=>x.find(predicate))].filter(predicate);}
}
let latestModal;
class Modal{constructor(){this.modalEl=new El();this.contentEl=new El();this.titleEl=new El();latestModal=this;}open(){this.opened=true;}close(){this.closed=true;}}
const ob={Plugin:class{},ItemView:class{},Modal,Notice:class{}};
const ctx={require:n=>n==='obsidian'?ob:require(n),module:{exports:{}},Intl,Date,URL,Buffer,setTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../obsidian-plugin/main.js'),'utf8'),ctx);
const Picker=ctx.module.exports.CandidatePickerModal;
const entryCompany={id:'entry',name:'多计划企业'};
const entryRecords=[{fields:{'招聘计划/岗位':'2027届常规校招（完整计划名称）'},links:{'投递入口':'https://example.org/campus?plan=1'}},{fields:{'招聘计划/岗位':'AI项目'},links:{'投递入口':'https://example.org/ai?plan=2'}},{fields:{'招聘计划/岗位':'重复来源'},links:{'投递入口':'https://example.org/campus?plan=1'}},{fields:{'招聘计划/岗位':'无效入口'},links:{'投递入口':'javascript:alert(1)'}}];
const entryUi=new ctx.module.exports.Dashboard({app:{},data:{candidateJobs:[]}},new El()),entryCell=new El();
entryUi.entrances(entryCell,entryCompany,entryRecords);
const entryButton=entryCell.find(e=>e.tag==='button')[0];assert.equal(entryButton.textContent,'投递入口 · 2 ▾');assert.equal(entryCell.find(e=>e.tag==='select').length,0);
const entryOpenTask=entryButton.onclick(),entryModal=latestModal;entryOpenTask.then(()=>{assert(entryModal.opened);assert.equal(entryModal.titleEl.textContent,'多计划企业 · 投递入口');const links=entryModal.contentEl.find(e=>e.tag==='a');assert.equal(links.length,2);assert.equal(links[0].options.href,entryRecords[0].links['投递入口']);assert.equal(links[1].options.href,entryRecords[1].links['投递入口']);assert.equal(links[0].find(e=>e.tag==='span')[0].textContent,'2027届常规校招（完整计划名称）');}).catch(e=>{console.error(e);process.exitCode=1});
const singleCell=new El();entryUi.entrances(singleCell,entryCompany,[entryRecords[0]]);assert.equal(singleCell.find(e=>e.tag==='a').length,1);assert.equal(singleCell.find(e=>e.tag==='button').length,0);
const c={id:'c',name:'隔离样例',wish:true};
const candidate=(id,name,graduateStatus)=>({id,companyId:'c',name,batch:'2027届',location:'南京',requirements:'本科及以上',graduateStatus,status:'待核实',checkedAt:'2026-10-05',sources:[]});
const data={companies:[c],records:[],candidateJobs:[candidate('a','岗位一','应届生'),candidate('b','岗位二','待核实'),candidate('old','历史岗位','应届生')],jobs:[{companyId:'c',name:'历史岗位',batch:'2027届',stage:'已投递',appliedDate:'2026-10-05'}]};
let saved=[],manual=false;
const p={app:{},data,addCandidates:async(id,ids)=>{saved=[...ids];},manualJob:()=>{manual=true;}};
const m=new Picker(p,c);m.onOpen();assert.equal(m.visible.length,2);assert(m.save.disabled);
const boxes=()=>m.list.find(el=>el.tag==='input'&&el.options.type==='checkbox');
boxes()[0].checked=true;boxes()[0].onchange();assert.equal(m.selected.size,1);assert.equal(m.save.textContent,'添加 1 个岗位');
m.search.value='岗位二';m.search.oninput();assert.equal(m.visible.length,1);assert.equal(m.selected.size,1);
m.contentEl.find(el=>el.tag==='button'&&el.textContent==='勾选当前结果')[0].onclick();assert.equal(m.selected.size,2);
m.search.value='';m.filter.value='全部岗位';m.filter.onchange();assert.equal(m.visible.length,3);const old=boxes().find(el=>el.options.attr['aria-label']==='选择 历史岗位');assert(old.disabled);assert.equal(old.checked,false);
m.filter.value='应届生岗位';m.filter.onchange();assert.equal(m.visible.length,1);assert.equal(m.selected.size,2);
(async()=>{await m.save.onclick();assert.deepEqual(saved,['a','b']);assert(m.closed);
const manualModal=new Picker(p,c);manualModal.onOpen();manualModal.contentEl.find(el=>el.tag==='button'&&el.textContent==='手动填写岗位')[0].onclick();assert(manual);assert(manualModal.closed);
console.log('PASS: picker search, selection across filters, bulk select, applied duplicate disabled, save IDs, manual entry');})().catch(e=>{console.error(e);process.exitCode=1});
