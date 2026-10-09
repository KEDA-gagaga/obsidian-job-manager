import assert from 'node:assert/strict';
import {extractJob} from '../chrome-extension/extractor.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
function element(text) { return {innerText: text, textContent: text, tagName: 'DIV', closest: () => null, getClientRects: () => [1]}; }
function page({postings = [], title = '', body = '', heading = '', company = '', tiles = []} = {}) {
  globalThis.location = {href: 'https://example.org/jobs/42?jobId=42#detail'};
  const scripts = postings.map(j => ({textContent: typeof j === 'string' ? j : JSON.stringify(j)}));
  globalThis.document = {title, body: element(body),
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return scripts;
      if (selector.includes(',') && selector.startsWith('.job-title')) return tiles.map(element);
      if (['h1', 'main h1'].includes(selector)) return heading ? [element(heading)] : [];
      if (selector === '.company-name') return company ? [element(company)] : [];
      return [];
    },
    querySelector(selector) { if (selector.startsWith('main,article')) return element(body); return null; },
    createElement() { return {set innerHTML(text) { this.content = {textContent: String(text).replace(/<[^>]*>/g, ''), querySelectorAll: () => []}; }, content: {textContent: '', querySelectorAll: () => []}}; }
  };
}
page({postings: [{'@graph': [{'@type': 'JobPosting', title: '材料工程师', hiringOrganization: {name: '北方华创'}, jobLocation: [{address: {addressLocality: '北京'}}], qualifications: '材料相关专业', responsibilities: '材料研究'}]}]});
let result = extractJob(); assert.equal(result.name, '材料工程师'); assert.equal(result.company.name, '北方华创'); assert.equal(result.location, '北京'); assert.equal(result.requirements, '材料相关专业'); assert.equal(result.url, location.href);
page({postings: [{'@type': 'JobPosting', title: 'A'}, {'@type': 'JobPosting', title: 'B'}], heading: '校园招聘'}); result = extractJob(); assert.equal(result.name, ''); assert(result.warnings.some(x => x.includes('多个岗位')));
page({postings: [{'@type': 'JobPosting', title: 'A', url: 'http://['}, {'@type': 'JobPosting', title: 'B', url: location.href}]}); result = extractJob(); assert.equal(result.name, 'B');
page({title: '材料工程师 | 北方华创', heading: '材料工程师', body: '工作地点：北京\n岗位职责\n工艺研究\n任职要求\n材料、化学相关专业\n立即投递'}); result = extractJob({companies: [{name: '北方华创（NAURA）', labels: ['北方华创']}]}); assert.equal(result.company.name, '北方华创（NAURA）'); assert.equal(result.requirements, '材料、化学相关专业'); assert.equal(result.responsibilities, '工艺研究');
page({title: '校园招聘', heading: '校园招聘', tiles: ['材料工程师', '研发工程师']}); result = extractJob(); assert.equal(result.name, '');
page({title: '岗位详情', heading: '岗位详情'}); result = extractJob(); assert.equal(result.name, ''); assert.equal(result.company.name, '');
page({title: '可靠性工程师 - 小米校园招聘', heading: '可靠性工程师', body: '职位\n小米招聘\n可靠性工程师\n北京、南京、上海\n校招\n2027届校园招聘计划\n职位要求\n理工科硕士\nRESUME PRO\n填表助手\n个人简历信息'}); result = extractJob({companies:[{name:'小米',labels:['小米']}]}); assert.equal(result.location,'北京、南京、上海');assert.equal(result.company.name,'小米');assert.equal(result.requirements,'理工科硕士');
page({title: '小米校园招聘', heading: '-', body: '职位描述\n--\n职位要求\n--\nRESUME PRO\n填表助手\n用户个人经历'}); result = extractJob(); assert.equal(result.name, ''); assert.equal(result.requirements, ''); assert.equal(result.responsibilities, ''); assert(!result.evidence.includes('用户个人经历'));
let listener, clicked; const session = {}; let nativeCalls = 0, windowsCreated = 0, windowsFocused = 0;
const chrome = {runtime: {id: 'test-id', getURL: file => 'chrome-extension://test-id/' + file, onMessage: {addListener: fn => {listener = fn;}},
  sendNativeMessage: async () => { nativeCalls++; return {ok: true, result: {added: 1}}; }},
  action: {onClicked: {addListener: fn => {clicked = fn;}}}, windows: {create: async options => {assert(options.url.endsWith('?sourceTab=42'));windowsCreated++;return {id: 8};}, update: async () => {windowsFocused++;}},
  storage: {session: {set: async value => Object.assign(session, value), get: async () => session}}};
vm.runInNewContext(fs.readFileSync(new URL('../chrome-extension/background.js', import.meta.url), 'utf8'), {chrome, Set, Date, String});
await clicked({id: 42}); await clicked({id: 42}); assert.equal(windowsCreated, 1); assert.equal(windowsFocused, 1);
assert.equal(listener({type: 'bridge', request: {action: 'save'}}, {id: 'other-id', url: 'https://example.org'}, () => {}), false); assert.equal(nativeCalls, 0);
const response = await new Promise(resolve => listener({type: 'bridge', request: {action: 'save', payload: {url: location.href}}}, {id: 'test-id', url: 'chrome-extension://test-id/popup.html?sourceTab=42'}, resolve));
assert.equal(response.ok, true); assert.equal(session.lastCapture.pending, false); assert.equal(session.lastCapture.response.result.added, 1);
console.log('扩展解析与桥接通过：结构化岗位、可见文本、列表拦截、企业匹配、调用方验证及保存回执。');
