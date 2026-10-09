import {extractJob} from './extractor.mjs';
const $ = id => document.getElementById(id);
const form = $('capture-form');
const fields = ['name', 'location', 'batch', 'url', 'requirements', 'responsibilities', 'notes'];
let context = {companies: []}, extracted = {}, receipt, tabUrl = '', pending = false, online = false, previewTimer;
const key = s => String(s || '').normalize('NFKC').replace(/[\s·•]+/g, '').toLowerCase();
const batchKey = s => { let k = key(s).replace(/校园招聘/g, '校招').replace(/校招计划$/, '校招'); return k.includes('校招') ? k.replace(/^(20\d{2})(?!届)/, '$1届') : k; };
const bridge = request => chrome.runtime.sendMessage({type: 'bridge', request});
async function focusPreview() { const w = await chrome.windows.getCurrent(); await chrome.windows.update(w.id, {focused: true}); }
function status(message, cls = '') { $('status').textContent = message; $('status').className = cls; }
function matches() { return context.companies.filter(c => c.labels.some(label => key(label) === key($('company').value))); }
function payload() {
  const found = matches(), selected = found.length > 1 ? found.find(c => c.id === $('company-match').value) : found[0];
  return {...Object.fromEntries(fields.map(id => [id, $(id).value.trim()])), company: {id: selected?.id || '', name: $('company').value.trim()},
    title: extracted.title || '', evidence: extracted.evidence || '', restoreArchived: $('restore').checked};
}
function companyHint() {
  const found = matches(), prior = $('company-match').value;
  $('company-match').replaceChildren(); $('company-match').hidden = found.length < 2;
  if (found.length > 1) {
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = '请选择准确的企业'; $('company-match').append(blank);
    for (const c of found) { const item = document.createElement('option'); item.value = c.id; item.textContent = c.name; $('company-match').append(item); }
    if (found.some(c => c.id === prior)) $('company-match').value = prior;
  }
  const selected = found.length > 1 ? found.find(c => c.id === $('company-match').value) : found[0];
  $('company-hint').textContent = !online ? '连接 Obsidian 后可匹配已有企业。' : found.length > 1 && !selected ? '多个企业匹配，请明确选择，避免合并不同组织。' : selected ? `已有企业：${selected.name} · ${selected.wish ? '已在心愿单' : '保存时自动加入心愿单'}` : $('company').value.trim() ? '未匹配已有企业，保存会新建。也可从下拉列表选择已有企业。' : '自动匹配已有企业；集团与子公司保留区分。';
  $('company-hint').className = 'hint' + (!selected && $('company').value.trim() ? ' warning' : '');
  const suggestions = $('company-suggestions'); suggestions.replaceChildren();
  const typed = key($('company').value);
  if (!found.length && typed.length >= 2) for (const c of context.companies.filter(c => c.labels.some(label => key(label).includes(typed) || typed.includes(key(label)))).slice(0, 3)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = '选用 ' + c.name;
    button.addEventListener('click', () => { $('company').value = c.name; companyHint(); preview(); }); suggestions.append(button);
  }
  $('restore-row').hidden = !selected?.archived;
  if (!selected?.archived) $('restore').checked = false;
  $('save').disabled = pending || !online || !form.checkValidity() || (found.length > 1 && !selected) || (selected?.archived && !$('restore').checked);
}
async function connect() {
  $('retry').hidden = true;
  $('connection-text').textContent = '正在连接 Obsidian…';
  try {
    const response = await bridge({action: 'context'});
    if (!response?.ok) throw new Error(response?.error || '连接失败。');
    context = response.result; online = true;
    status('');
    $('connection-dot').className = 'dot online'; $('connection-text').textContent = `${context.vault} · 已连接`;
    const list = $('companies'); list.replaceChildren();
    for (const c of context.companies) for (const label of c.labels) {
      const option = document.createElement('option'); option.value = label; option.label = label === c.name ? c.name : c.name + ' · 别名'; list.append(option);
    }
    companyHint(); await focusPreview(); return true;
  } catch (error) {
    online = false; $('connection-dot').className = 'dot'; $('connection-text').textContent = 'Obsidian 未连接'; $('retry').hidden = false;
    status(error.message, 'error'); companyHint(); return false;
  }
}
function showReceipt(result) {
  receipt = result; form.hidden = true; $('receipt').hidden = false; $('save').disabled = false;
  $('receipt-title').textContent = result.added ? '已加入岗位' : result.view === '投递' ? '这份岗位已投递' : '这份岗位已存在';
  $('receipt-detail').textContent = `${result.company}\n${result.name}\n${result.added ? '企业已加入心愿单，岗位为待准备。' : result.view === '投递' ? '保留原投递阶段、日期与简历，可在“投递”中查看。' : '已去重，保留原进度与简历。'}`;
  $('undo').hidden = !result.undoToken;
  $('open').textContent = `在 Obsidian「${result.view}」中查看`;
  status(result.supplemented ? `已补充 ${result.supplemented} 项原先缺失的信息。` : '保存完成。');
}
async function preview() {
  companyHint();
  if (!online || pending) return;
  if (!form.checkValidity() || (matches().length > 1 && !$('company-match').value)) {
    status(extracted.warnings?.join('\n') || '请填写企业和具体岗位名称，再保存。'); return;
  }
  const input = payload();
  const duplicate = context.jobs?.find(j => j.companyId === input.company.id && key(j.name) === key(input.name) && batchKey(j.batch) === batchKey(input.batch));
  if (duplicate) status(`已有同名岗位 · ${duplicate.stage}。保存时再次去重，保留已有进度与简历。`);
  else status(extracted.warnings?.filter(x => (!x.includes('企业未') || !$('company').value) && (!x.includes('岗位名称') || !$('name').value) && (!x.includes('要求未') || !$('requirements').value)).join('\n') || '请核对后保存，Obsidian 会再次检查企业与岗位是否重复。');
}
function pendingState() { pending = true; $('save').disabled = true; $('save').textContent = '正在保存…'; status('正在保存到 Obsidian。关闭此窗口也会继续保存，请等待结果。'); }
form.addEventListener('submit', async event => {
  event.preventDefault(); if (pending || !online) return;
  if (!form.reportValidity()) return;
  if (matches().length > 1 && !$('company-match').value) { status('请先选择准确企业。', 'error'); return; }
  pendingState();
  try {
    const response = await bridge({action: 'save', payload: payload()});
    pending = false; $('save').textContent = '保存到岗位';
    if (!response?.ok) throw new Error(response?.error || '保存失败。');
    showReceipt(response.result);
    await focusPreview();
  } catch (error) { pending = false; companyHint(); $('save').textContent = '保存到岗位'; status(error.message, 'error'); }
});
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !form.hidden) { event.preventDefault(); if (!$('save').disabled) form.requestSubmit(); } });
for (const field of [...fields, 'company', 'company-match', 'restore']) $(field).addEventListener('input', () => { clearTimeout(previewTimer); companyHint(); previewTimer = setTimeout(preview, 400); });
$('retry').addEventListener('click', async () => { if (await connect()) await preview(); });
$('help').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('help.html')}));
$('open').addEventListener('click', async () => {
  $('open').disabled = true;
  try { const r = await bridge({action: 'open', jobId: receipt?.jobId}); if (!r?.ok) throw new Error(r?.error || '打开失败。'); } catch (e) { status(e.message, 'error'); }
  $('open').disabled = false;
});
$('undo').addEventListener('click', async () => {
  $('undo').disabled = true;
  try {
    const r = await bridge({action: 'undo', token: receipt.undoToken}); if (!r?.ok) throw new Error(r?.error || '撤销失败。');
    await chrome.storage.session.remove('lastCapture'); receipt = undefined; $('receipt').hidden = true; form.hidden = false;
    await connect(); status('已撤销这次保存，岗位和心愿单恢复到保存前。');
  } catch (e) { status(e.message, 'error'); }
  $('undo').disabled = false;
});
$('edit-again').addEventListener('click', () => { $('receipt').hidden = true; form.hidden = false; preview(); });
chrome.storage.onChanged.addListener((changes, area) => {
  const saved = changes.lastCapture?.newValue;
  if (area === 'session' && saved?.url === tabUrl && !saved.pending && saved.response && pending) {
    pending = false; $('save').textContent = '保存到岗位';
    if (saved.response.ok) showReceipt(saved.response.result); else { companyHint(); status(saved.response.error, 'error'); }
  }
});
async function init() {
  const connected = await connect();
  try {
    const source = new URLSearchParams(location.search).get('sourceTab');
    const tab = source && /^\d+$/.test(source) ? await chrome.tabs.get(Number(source)) : (await chrome.tabs.query({active: true, currentWindow: true}))[0]; tabUrl = tab?.url || '';
    if (!/^https?:\/\//.test(tabUrl)) throw new Error('请在公司招聘网站的具体岗位页面使用扩展。');
    const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: extractJob, args: [{companies: context.companies}]});
    extracted = result; $('company').value = result.company.name;
    for (const field of fields) $(field).value = result[field] || '';
    $('source').href = tabUrl; $('source').textContent = new URL(tabUrl).hostname + ' · ' + result.method;
    $('detail-hint').textContent = result.requirements || result.responsibilities ? '已提取，可修改' : '可补充';
    companyHint();
    const {lastCapture} = await chrome.storage.session.get('lastCapture');
    if (lastCapture?.url === tabUrl && Date.now() - lastCapture.savedAt < 60 * 60 * 1000) {
      if (lastCapture.pending && Date.now() - lastCapture.savedAt < 90000) { pendingState(); return; }
      if (lastCapture.response?.ok) { showReceipt(lastCapture.response.result); return; }
    }
    if (connected) await preview();
  } catch (error) { status(error.message, 'error'); companyHint(); }
}
init();
