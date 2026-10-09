const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {P,R}=require('../obsidian-plugin/main.js');
const dir=path.join(__dirname,'../templates/vault/工作投递/模板');
function sample(name){const raw=fs.readFileSync(path.join(dir,name),'utf8');return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)[1]);}
const research=sample('06-企业岗位调研模板.md');
assert(research.company.id);const normalized=R.normalize(research,research.company.id);
assert.equal(normalized.candidates.length,1);assert.equal(normalized.candidates[0].graduateStatus,'待核实');
const draft=sample('07-岗位文案与网申辅助模板.md');assert(draft.jobId);assert(draft.resume);assert(P.draftText(draft.body));
console.log('PASS: documented AI import samples match plugin schema');
