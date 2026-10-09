/* 工作投递独立模块。业务规则见 [[工作投递管理规则]]。 */
let ob;
try { ob = require('obsidian'); } catch (_) { ob = null; }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFile} = require('child_process');
const ID = 'keda-job-applications', VIEW = 'keda-job-applications-view';
const DATA = '工作投递/数据/工作投递数据.json';
const TOPIC = '工作投递管理系统';
const RESUME = '工作投递/简历/基础工作简历-纯文本版.md';
const WEB_LINK_FILE = '';
const STAGES = ['待准备', '待投递', '已投递', '笔试', '面试', '录用', '未通过', '已撤回'];
const clone = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const day = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai'}).format(new Date());
const safeUrl = url => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
const P = {
  merge(old, input) {
    const d = old ? clone(old) : {schema: 1, 索引: ['[[工作投递管理系统]]'], companies: [], records: [], jobs: [], revision: 0};
    const cs = new Map(d.companies.map(c => [c.id, c]));
    for (const c of input.companies) {
      const prev = cs.get(c.id);
      cs.set(c.id, {...c, ...prev, name: c.name, aliases: [...new Set([...(prev?.aliases || []), ...c.aliases])],
        recordIds: [...new Set([...(prev?.recordIds || []), ...c.recordIds])]});
    }
    d.companies = [...cs.values()];
    const rs = new Map(d.records.map(r => [r.id, r]));
    for (const r of input.records) rs.set(r.id, r);
    d.records = [...rs.values()];
    const js = new Map(d.jobs.map(j => [j.id, j]));
    for (const j of input.initialJobs) if (!js.has(j.id)) js.set(j.id, j);
    d.jobs = [...js.values()];
    d.meta = {...input, companies: undefined, records: undefined, initialJobs: undefined};
    return d;
  },
  insertDiary(text, line) {
    const ls = text.split('\n');
    let start = ls.findIndex(l => /^###\s/.test(l) && l.includes(`[[${TOPIC}]]`));
    if (start < 0) {
      let main = ls.findIndex(l => /^##\s+主线\s*$/.test(l));
      if (main < 0) { ls.push('', '## 主线', ''); main = ls.length - 2; }
      let end = main + 1;
      while (end < ls.length && !/^#{1,2}\s/.test(ls[end])) end++;
      ls.splice(end, 0, '', `### 💼 [[${TOPIC}]]`, '', line, '');
    } else {
      let end = start + 1;
      while (end < ls.length && !/^#{1,3}\s/.test(ls[end])) end++;
      while (end > start + 1 && !ls[end - 1].trim()) end--;
      ls.splice(end, 0, line);
    }
    return ls.join('\n');
  },
  filtered(d, tab, query = '', filter = '全部') {
    let rows = ['企业', '心愿单', '已归档'].includes(tab) ? d.companies : d.jobs;
    if (tab === '企业') rows = rows.filter(c => !c.wish && !c.archived);
    if (tab === '心愿单') rows = rows.filter(c => c.wish && !c.archived);
    if (tab === '已归档') rows = rows.filter(c => c.archived);
    if (tab === '心愿单' && ['未添加岗位', '已添加岗位', '已投递'].includes(filter)) rows = rows.filter(c => {
      const progress = P.companyProgress(d, c.id);
      return filter === '未添加岗位' ? progress.total === 0 : filter === '已添加岗位' ? progress.total > 0 : progress.applied > 0;
    });
    if (tab === '投递') rows = rows.filter(j => !j.archived && P.isApplied(j));
    if (tab === '岗位') rows = rows.filter(j => !j.archived && !P.isApplied(j) && d.companies.some(c => c.id === j.companyId && c.wish && !c.archived));
    if (tab === '已归档岗位') rows = rows.filter(j => j.archived && (filter === '未投递' ? !P.isApplied(j) : filter === '已投递' ? P.isApplied(j) : true));
    if (tab === '岗位' && ['待准备', '待投递'].includes(filter)) rows = rows.filter(j => j.stage === filter);
    if (tab === '投递' && filter === '进行中') rows = rows.filter(j => !['录用', '未通过', '已撤回'].includes(j.stage));
    if (tab === '企业' && filter === '有投递入口') rows = rows.filter(c => safeUrl(c.research?.applicationUrl) || (d.candidateJobs || []).some(j => j.companyId === c.id && safeUrl(j.url)) || d.records.some(r => r.companyId === c.id && safeUrl(r.links['投递入口'])));
    const needle = query.toLocaleLowerCase().trim();
    if (needle) rows = rows.filter(r => [r.name, r.business, r.notes, r.location, r.batch,
      ...(r.aliases || []), d.companies.find(c => c.id === r.companyId)?.name,
      ...(r.recordIds ? [r.research?.summary, ...(r.research?.locations || []), ...(d.candidateJobs || []).filter(j => j.companyId === r.id).map(j => `${j.name} ${j.location} ${j.requirements}`)] : []),
      ...(r.recordIds ? d.records.filter(x => x.companyId === r.id).map(x => x.fields['工作地点']) : [])
      ].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle));
    return rows.slice().sort((a, b) => (tab === '已归档岗位' ? String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')) : 0) || (tab === '岗位' ? Number(!!b.pinned) - Number(!!a.pinned) || (a.pinned && b.pinned ? String(b.pinnedAt || '').localeCompare(String(a.pinnedAt || '')) : 0) : 0) || Number(!!b.wish) - Number(!!a.wish) || a.name.localeCompare(b.name, 'zh-CN'));
  },
  isApplied: j => !!j.appliedDate || !['待准备', '待投递'].includes(j.stage),
  jobTab: j => j?.archived ? '已归档岗位' : j && P.isApplied(j) ? '投递' : '岗位',
  companyProgress(d, companyId) {
    const jobs = d.jobs.filter(j => j.companyId === companyId && !j.archived), applied = jobs.filter(P.isApplied).length;
    return {total: jobs.length, pending: jobs.length - applied, applied};
  },
  draftText(raw) {
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const match = /^# 可直接使用的文案\s*\r?\n([\s\S]*?)(?=^#\s|$(?![\s\S]))/m.exec(body);
    return match?.[1]?.trim() || '';
  },
  safeUrl, day, STAGES,
};

const R = {
  text(v) { if (v == null) return ''; if (!['string', 'number'].includes(typeof v)) throw new Error('事实字段需为文本。'); return String(v).trim(); },
  list(v) { return [...new Set((Array.isArray(v) ? v : v ? [v] : []).map(R.text).filter(Boolean))]; },
  companyKey(v) { return R.text(v).normalize('NFKC').replace(/[\s·•]+/g, '').toLocaleLowerCase(); },
  jobKey(j) { return [j.name, j.batch].map(v => R.text(v).normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()).join('\u0000'); },
  sources(values) {
    if (!Array.isArray(values)) throw new Error('来源需为数组。');
    const result = [];
    for (const v of values || []) {
      if (!v || typeof v !== 'object') throw new Error('来源必须是包含网址或截图附件的对象。');
      const url = R.text(v.url), attachment = R.text(v.attachment);
      if (url && !safeUrl(url)) throw new Error('来源网址无效：' + url);
      if (attachment && (!attachment.startsWith('工作投递/附件/') || attachment.split('/').includes('..'))) throw new Error('截图来源需使用本库附件路径。');
      if (!url && !attachment) throw new Error('每条来源至少需要一个网址或截图附件。');
      result.push({url: safeUrl(url), attachment, title: R.text(v.title), evidence: R.text(v.evidence)});
    }
    return [...new Map(result.map(x => [JSON.stringify(x), x])).values()];
  },
  normalize(payload, companyId, kind = 'ai-research', screenshotSources = []) {
    if (!payload || !Array.isArray(payload.candidates)) throw new Error('调研结果需要 candidates 岗位数组。');
    if (payload.candidates.length > 500) throw new Error('单次最多保存500个候选岗位。');
    const checkedAt = R.text(payload.checkedAt) || day();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) throw new Error('核实日期需为 YYYY-MM-DD。');
    const sources = R.sources([...(payload.sources || []), ...screenshotSources]);
    const applicationUrl = R.text(payload.applicationUrl);
    if (applicationUrl && !safeUrl(applicationUrl)) throw new Error('企业投递入口无效。');
    if ((R.text(payload.summary) || R.list(payload.locations).length || applicationUrl) && !sources.length) throw new Error('企业调研事实需要来源网址或截图。');
    const candidates = payload.candidates.map(input => {
      if (!input || typeof input !== 'object') throw new Error('候选岗位需为包含具体名称的对象。');
      const name = R.text(input.name), batch = R.text(input.batch), url = R.text(input.url);
      if (!name) throw new Error('候选岗位需明确具体岗位名称。');
      if (url && !safeUrl(url)) throw new Error('岗位投递入口无效：' + name);
      const refs = R.sources([...(input.sources || sources), ...screenshotSources]);
      if (!refs.length) throw new Error('岗位缺少来源网址或截图：' + name);
      const deadline = R.text(input.deadline);
      if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error('截止日期需为 YYYY-MM-DD：' + name);
      const status = ['已核实', '待核实'].includes(input.status) ? input.status : '待核实';
      const graduateStatus = ['应届生', '非应届', '待核实'].includes(input.graduateStatus) ? input.graduateStatus : '待核实';
      return {id: 'candidate-' + hash(companyId + '\u0000' + R.jobKey({name, batch})).slice(0, 20), companyId, name, batch,
        location: R.list(input.locations || input.location).join('、'), url: safeUrl(url || applicationUrl), requirements: R.text(input.requirements),
        responsibilities: R.text(input.responsibilities), deadline, deadlineVerified: input.deadlineVerified === true,
        graduateStatus, status, sources: refs, checkedAt, kind, 索引: [`[[${TOPIC}]]`]};
    });
    const unique = new Map();
    for (const j of candidates) {
      const previous = unique.get(j.id);
      if (previous) {
        const merged = {...previous, ...j};
        for (const field of ['url', 'requirements', 'responsibilities', 'deadline']) if (!j[field]) merged[field] = previous[field];
        merged.location = [...new Set([previous.location, j.location].filter(Boolean))].join('、');
        merged.sources = R.sources([...previous.sources, ...j.sources]);
        if (!j.deadline) merged.deadlineVerified = previous.deadlineVerified;
        unique.set(j.id, merged);
      } else unique.set(j.id, j);
    }
    return {checkedAt, summary: R.text(payload.summary), locations: R.list(payload.locations), applicationUrl: safeUrl(applicationUrl),
      sources, unknowns: R.list(payload.unknowns), candidates: [...unique.values()]};
  },
  save(d, company, report) {
    const old = company.research || {};
    company.research = {...old, checkedAt: report.checkedAt, summary: report.summary || old.summary || '',
      locations: [...new Set([...(old.locations || []), ...report.locations, ...report.candidates.map(j => j.location).filter(Boolean)])], applicationUrl: report.applicationUrl || old.applicationUrl || '',
      sources: R.sources([...(old.sources || []), ...report.sources]), unknowns: report.unknowns};
    d.candidateJobs ||= [];
    for (const item of report.candidates) {
      const previous = d.candidateJobs.find(j => j.id === item.id);
      if (previous) {
        const merged = {...item};
        for (const field of ['location', 'url', 'requirements', 'responsibilities', 'deadline']) if (!merged[field]) merged[field] = previous[field] || '';
        merged.sources = R.sources([...(previous.sources || []), ...item.sources]);
        if (!item.deadline) merged.deadlineVerified = !!previous.deadlineVerified;
        Object.assign(previous, merged);
      } else d.candidateJobs.push(item);
    }
  },
  add(d, companyId, ids, fillMissing = false) {
    if (d.companies.find(c => c.id === companyId)?.archived) throw new Error('该企业已归档，请先到“已归档企业”还原后添加岗位。');
    let added = 0, skipped = 0, supplemented = 0;
    for (const id of [...new Set(ids)]) {
      const candidate = (d.candidateJobs || []).find(j => j.id === id && j.companyId === companyId);
      if (!candidate) throw new Error('候选岗位已变化，请重新打开选择列表。');
      const previous = d.jobs.find(j => j.companyId === companyId && R.jobKey(j) === R.jobKey(candidate));
      if (previous) {
        if (fillMissing) {
          let changed = false;
          for (const field of ['location', 'url', 'requirements', 'responsibilities']) if (!previous[field] && candidate[field]) { previous[field] = candidate[field]; changed = true; }
          if (changed) { previous.sources = R.sources([...(previous.sources || []), ...candidate.sources]); previous.candidateId ||= candidate.id; }
          if (changed) supplemented++;
        }
        skipped++; continue;
      }
      d.jobs.push({id: 'job-' + crypto.randomBytes(8).toString('hex'), companyId, name: candidate.name, batch: candidate.batch,
        location: candidate.location, url: candidate.url, requirements: candidate.requirements, responsibilities: candidate.responsibilities,
        deadline: candidate.deadlineVerified ? candidate.deadline : '', stage: '待准备', appliedDate: '', resume: '', notes: '',
        candidateId: candidate.id, sources: clone(candidate.sources), graduateStatus: candidate.graduateStatus,
        researchCheckedAt: candidate.checkedAt, createdAt: day(), 索引: [`[[${TOPIC}]]`]});
      added++;
    }
    return {added, skipped, supplemented};
  },
};

// Browser captures are user-selected target jobs, separate from AI research candidates.
const B = {
  labels(c) { return [...new Set([c.name, ...(c.aliases || []), c.name.replace(/[（(][A-Za-z0-9 &.\-]+[）)]$/, '').trim()].filter(Boolean))]; },
  text(value, max, label) { const text = R.text(value); if (text.length > max) throw new Error(label + '内容过长，请精简后保存。'); return text; },
  url(value) {
    const raw = R.text(value), url = safeUrl(raw);
    if (!url || new URL(url).username || new URL(url).password) throw new Error('岗位入口需为有效的 http 或 https 网页。');
    return url;
  },
  urlKey(value) {
    const safe = safeUrl(value); if (!safe) return '';
    const u = new URL(safe);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || ['gclid', 'fbclid', 'msclkid'].includes(k)) u.searchParams.delete(k);
    u.searchParams.sort(); return u.href;
  },
  detailUrl(value) {
    const u = new URL(B.url(value));
    if ([...u.searchParams.keys()].some(k => /^(job_?id|position_?id|requisition_?id|post_?id)$/i.test(k) && u.searchParams.get(k))) return true;
    const match = /(?:^|\/)(?:jobs?|positions?|requisitions?|postings?)(?:\/detail)?\/([a-z0-9_-]{4,})/i.exec(u.pathname + u.hash);
    return !!match && !/^(search|list|campus|apply|detail|details|index)$/i.test(match[1]);
  },
  batchKey(value) {
    let key = R.companyKey(value).replace(/校园招聘/g, '校招').replace(/校招计划$/, '校招');
    if (key.includes('校招')) key = key.replace(/^(20\d{2})(?!届)/, '$1届');
    return key;
  },
  normalize(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('岗位数据格式无效。');
    const company = {id: B.text(payload.company?.id, 100, '企业编号'), name: B.text(payload.company?.name, 180, '企业名称')};
    const name = B.text(payload.name, 240, '岗位名称');
    if (!company.name && !company.id) throw new Error('请填写或选择企业。');
    if (!name || /^[-—–·\s]+$/.test(name) || /^(招聘|校园招聘|社会招聘|职位列表|岗位列表|人才招聘|加入我们|职位详情|岗位详情|job\s*details?|careers?|jobs?)$/i.test(name)) throw new Error('请填写当前页面的具体岗位名称。');
    return {company, name, batch: B.text(payload.batch, 160, '招聘批次'), location: B.text(payload.location, 400, '工作地点'),
      url: B.url(payload.url), requirements: B.text(payload.requirements, 12000, '岗位要求'), responsibilities: B.text(payload.responsibilities, 12000, '岗位职责'),
      title: B.text(payload.title, 400, '页面标题'), evidence: B.text(payload.evidence, 1600, '页面依据'),
      notes: B.text(payload.notes, 2000, '个人备注'), restoreArchived: payload.restoreArchived === true};
  },
  company(d, requested) {
    if (requested.id) {
      const c = d.companies.find(c => c.id === requested.id);
      if (!c) throw new Error('所选企业已不存在，请重新打开扩展。');
      return c;
    }
    const matches = d.companies.filter(c => B.labels(c).some(n => R.companyKey(n) === R.companyKey(requested.name)));
    if (matches.length > 1) throw new Error('企业名称有多条匹配，请从已有企业中明确选择。');
    return matches[0];
  },
  existing(d, companyId, input) {
    const jobs = d.jobs.filter(j => j.companyId === companyId);
    const exact = jobs.find(j => R.companyKey(j.name) === R.companyKey(input.name) && B.batchKey(j.batch) === B.batchKey(input.batch)); if (exact) return exact;
    // An absent batch is not evidence of a new campaign. Preserve explicit different batches.
    const matches = jobs.filter(j => (!j.batch || !input.batch || B.batchKey(j.batch) === B.batchKey(input.batch)) &&
      (R.companyKey(j.name) === R.companyKey(input.name) || B.detailUrl(input.url)) &&
      [j.url, ...(j.browserCapture?.urls || [])].some(url => B.urlKey(url) && B.urlKey(url) === B.urlKey(input.url)));
    if (matches.length > 1) throw new Error('同一岗位链接对应多条已有记录，请到 Obsidian 核对后再保存。');
    return matches[0];
  },
  preview(d, input) {
    const c = B.company(d, input.company), job = c && B.existing(d, c.id, input);
    return {companyId: c?.id || '', company: c?.name || input.company.name, newCompany: !c, archived: !!c?.archived,
      wished: !!c?.wish, duplicate: !!job, jobId: job?.id || '', stage: job?.stage || '待准备', jobArchived: !!job?.archived, view: P.jobTab(job)};
  },
};

function run(exe, args) {
  return new Promise((resolve, reject) => execFile(exe, args, {maxBuffer: 12 * 1024 * 1024, timeout: 30000}, (err, stdout, stderr) => {
    if (err) reject(new Error((stderr || err.message).trim())); else { try { resolve(JSON.parse(stdout)); } catch (_) { reject(new Error('返回数据格式不正确。')); } }
  }));
}


class JobSettings extends (ob?.PluginSettingTab || class {}) {
  display() {
    const {containerEl: el} = this; el.empty();
    el.createEl('h2', {text: '工作投递设置'});
    el.createEl('p', {text: '业务文件位于本库的工作投递目录。Chrome 目标库与连接程序由安装向导登记。'});
    for (const [key, name, hint] of [
      ['excel','招聘 Excel 路径','可选，兼容投递信息／招聘会信息工作表'],
      ['visualizationUrl','招聘日程网址','可选，不配置时无需使用网页入口'],
      ['runtimeExe','连接程序路径','安装向导自动设置，迁移电脑后重新运行安装向导']
    ]) new ob.Setting(el).setName(name).setDesc(hint).addText(t => t.setValue(this.plugin.settings[key] || '').onChange(async value => {
      this.plugin.settings[key] = value.trim(); await this.plugin.saveData(this.plugin.settings);
    }));
    new ob.Setting(el).setName('检查本库数据').addButton(b => b.setButtonText('检查').onClick(async () => {
      try { await this.plugin.reloadData(); this.plugin.notice('数据结构正常。Chrome 连接请使用安装包的检查连接入口。'); }
      catch (e) { this.plugin.notice(e); }
    }));
  }
}

const Base = ob?.Plugin || class {};
class JobPlugin extends Base {
  async onload() {
    this.settings = await this.loadData() || {};
    this.settings.backupDir = path.join(this.app.vault.adapter.basePath, '.obsidian/job-manager-backups');
    fs.mkdirSync(this.settings.backupDir, {recursive: true});
    const baseline = path.join(this.settings.backupDir, 'manifest.json');
    if (!fs.existsSync(baseline)) fs.writeFileSync(baseline, JSON.stringify({files:{}}));
    this.addSettingTab(new JobSettings(this.app, this));
    this.addRibbonIcon('briefcase-business', '工作投递', () => this.openPanel());
    this.roots = new Set(); this.queue = Promise.resolve(); this.busy = false;
    await this.reloadData();
    this.registerView(VIEW, leaf => new JobView(leaf, this));
    this.addCommand({id: 'open', name: '打开工作投递控制台', callback: () => this.openPanel()});
    this.addCommand({id: 'refresh-excel', name: '从 Excel 刷新招聘信息', callback: () => this.refreshExcel()});
    this.addCommand({id: 'visualization-web', name: '打开可视化网页', callback: () => this.openVisualization().catch(e => this.notice(e))});
    this.addCommand({id: 'undo', name: '撤销最近一次工作投递操作', callback: () => this.undo()});
    this.addCommand({id: 'rollback', name: '回退到工作投递模块安装前', callback: () => this.rollbackDialog()});
    this.registerMarkdownCodeBlockProcessor('keda-job', (src, el, ctx) => {
      const c = new ob.Component(); ctx.addChild(c); this.mount({container: el, component: c});
    });
    this.registerEvent(this.app.vault.on('modify', f => {
      if (f.path === DATA && !this.busy) this.reloadData().then(() => this.refreshRoots()).catch(e => this.notice(e));
      if (f.path.startsWith('工作投递/日记/')) this.refreshDiaries();
    }));
  }
  onunload() { for (const ui of this.roots) ui.jobMenu?.hide(); this.app.workspace.getLeavesOfType(VIEW).forEach(l => l.detach()); this.roots.clear(); }
  notice(e) { new ob.Notice(e?.message || String(e), 6500); }
  visualizationUrl() {
    if (this.settings.visualizationUrl) return safeUrl(this.settings.visualizationUrl);
    const file = this.settings.visualizationUrlFile || WEB_LINK_FILE;
    try { return safeUrl(fs.readFileSync(file, 'utf8').trim()); } catch (_) { return ''; }
  }
  async openVisualization() {
    const url = this.visualizationUrl();
    if (!url) throw new Error('未找到有效的可视化网页链接，请核对招聘日程的链接文件。');
    await require('electron').shell.openExternal(url);
  }
  async reloadData() {
    const raw = await this.app.vault.adapter.read(DATA);
    this.data = JSON.parse(raw);
    if (this.data.schema !== 1 || !Array.isArray(this.data.companies) || !Array.isArray(this.data.jobs)) throw new Error('模块数据格式不支持。');
    this.dataHash = hash(raw);
  }
  openNote(note) {
    const k = null;
    if (k) return k.open(note, null, true);
    return this.app.workspace.openLinkText(note, '', 'tab');
  }
  async openPanel() {
    const h = null;
    if (h?.settings?.dashboards?.some(d => d.id === 'keda-job-dashboard')) {
      await h.setActiveDashboard('keda-job-dashboard'); await h.activateView();
    } else {
      let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
      if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({type: VIEW, active: true}); }
      this.app.workspace.revealLeaf(leaf);
    }
  }
  mount(dv) {
    const root = dv.container.createDiv({cls: 'kja-root'});
    const ui = new Dashboard(this, root); this.roots.add(ui); ui.mount();
    if (dv.component) dv.component.register(() => { ui.dead = true; this.roots.delete(ui); });
    return ui;
  }
  refreshRoots() { for (const ui of this.roots) if (!ui.dead) ui.refresh(); }
  refreshDiaries() { for (const ui of this.roots) if (!ui.dead) ui.renderDiary(); }
  async snapshotRuntime(rel) {
    const dir = this.settings.backupDir, file = path.join(dir, 'runtime-before.json');
    const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const original = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (entries[rel] || original.files[rel]) return;
    const full = path.join(this.app.vault.adapter.basePath, rel), exists = fs.existsSync(full);
    const backupRel = 'runtime/' + rel;
    if (exists) { fs.mkdirSync(path.dirname(path.join(dir, backupRel)), {recursive: true}); fs.copyFileSync(full, path.join(dir, backupRel)); }
    entries[rel] = {exists, backup: exists ? backupRel : null, sha256: exists ? hash(fs.readFileSync(full)) : null};
    fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  }
  async flushDiary(rel) {
    const k = null, f = this.app.vault.getAbstractFileByPath(rel);
    if (k && f) await k.flush(f);
  }
  async fileContent(rel, binary = false) {
    const a = this.app.vault.adapter;
    if (!await a.exists(rel)) return null;
    return binary ? Buffer.from(await a.readBinary(rel)).toString('base64') : a.read(rel);
  }
  async writeChecked(rel, before, after, binary = false) {
    const adapter = this.app.vault.adapter, file = this.app.vault.getAbstractFileByPath(rel);
    if (!binary && file && rel.endsWith('.md') && after !== null) {
      await this.app.vault.process(file, current => {
        if (current !== before) throw new Error('文件已被其他编辑更新，请重试：' + rel);
        return after;
      });
    } else {
      const exists = await adapter.exists(rel);
      const current = await this.fileContent(rel, binary);
      if (current !== before) throw new Error('数据已变化，请刷新后重试：' + rel);
      if (after === null) { if (file) await this.app.vault.delete(file); else if (exists) await adapter.remove(rel); }
      else if (binary) {
        const b = Buffer.from(after, 'base64'), bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        if (file) await this.app.vault.modifyBinary(file, bytes); else await this.app.vault.createBinary(rel, bytes);
      } else if (file) await this.app.vault.modify(file, after);
      else await this.app.vault.create(rel, after);
    }
  }
  transact(label, update, options = {}) {
    if (this.restoring) return Promise.reject(new Error('正在恢复安装前状态，请稍候。'));
    const task = async () => {
      this.busy = true;
      try {
        const before = await this.app.vault.adapter.read(DATA);
        const d = JSON.parse(before), files = [];
        const tx = {addFile: async (rel, after) => {
          await this.flushDiary(rel);
          const exists = await this.app.vault.adapter.exists(rel);
          files.push({rel, before: exists ? await this.app.vault.adapter.read(rel) : null, after});
        }, addBinary: async (rel, bytes) => {
          files.push({rel, binary: true, before: await this.fileContent(rel, true), after: Buffer.from(bytes).toString('base64')});
        }, diary: async line => {
          const rel = `工作投递/日记/${day()}.md`; await this.flushDiary(rel);
          const exists = await this.app.vault.adapter.exists(rel);
          const text = exists ? await this.app.vault.adapter.read(rel) : `---\n所在文件夹: 日记\n日期: ${day()}\n---\n\n## 主线\n\n## 随记\n\n## 复盘\n`;
          files.push({rel, before: exists ? text : null, after: P.insertDiary(text, line)});
        }};
        const result = await update(d, tx);
        if (options.skipUnchanged && !files.length && JSON.stringify(d) === JSON.stringify(JSON.parse(before))) return result;
        d.revision = (d.revision || 0) + 1;
        const after = JSON.stringify(d, null, 2) + '\n';
        const historyDir = path.join(this.settings.backupDir, 'history'); fs.mkdirSync(historyDir, {recursive: true});
        const history = path.join(historyDir, `${Date.now()}-${d.revision}.json`);
        const entry = {label, dataBefore: before, dataAfterHash: hash(after), files};
        fs.writeFileSync(history, JSON.stringify(entry));
        for (const x of files) await this.snapshotRuntime(x.rel);
        const written = [];
        try {
          for (const x of files) { await this.writeChecked(x.rel, x.before, x.after, x.binary); written.push(x); }
          await this.writeChecked(DATA, before, after);
        } catch (e) {
          for (const x of written.reverse()) await this.writeChecked(x.rel, x.after, x.before, x.binary).catch(() => {});
          throw e;
        }
        this.settings.undo = [...(this.settings.undo || []), history].slice(-30);
        await this.saveData(this.settings); await this.reloadData();
        new ob.Notice(`${label} · 可用“撤销”退回`, 3500);
        return result;
      } catch (e) { this.notice(e); throw e; }
      finally { this.busy = false; this.refreshRoots(); }
    };
    const p = this.queue.then(task); this.queue = p.catch(() => {}); return p;
  }
  async undo(expectedToken = '') {
    const task = async () => {
      this.busy = true;
      try {
        const file = this.settings.undo?.at(-1);
        if (expectedToken && (!file || hash(file) !== expectedToken)) throw new Error('已有后续操作，请到 Obsidian 中按顺序撤销。');
        if (!file) return this.notice('没有可撤销的操作。');
        const e = JSON.parse(fs.readFileSync(file, 'utf8')), current = await this.app.vault.adapter.read(DATA);
        if (hash(current) !== e.dataAfterHash) throw new Error('数据已被其他操作修改，未覆盖；请使用完整回退或先核对。');
        for (const x of e.files) {
          await this.flushDiary(x.rel);
          const now = await this.fileContent(x.rel, x.binary);
          if (now !== x.after) throw new Error('相关文件有后续编辑，未覆盖：' + x.rel);
        }
        for (const x of e.files.slice().reverse()) await this.writeChecked(x.rel, x.after, x.before, x.binary);
        await this.writeChecked(DATA, current, e.dataBefore);
        this.settings.undo.pop(); await this.saveData(this.settings); await this.reloadData();
        this.notice('已撤销：' + e.label);
      } catch (e) { this.notice(e); if (expectedToken) throw e; }
      finally { this.busy = false; this.refreshRoots(); }
    };
    const p = this.queue.then(task); this.queue = p.catch(() => {}); return p;
  }
  async refreshExcel() {
    if (this.importing) return;
    this.importing = true; this.refreshRoots();
    try {
      if (!this.settings.runtimeExe || !this.settings.excel) throw new Error('请先在工作投递设置中选择招聘 Excel，并运行安装包登记连接程序。');
      const input = await run(this.settings.runtimeExe, ['--excel', this.settings.excel]);
      if (input.sourceHash === this.data.meta?.sourceHash) return this.notice('Excel 内容没有变化，无需重复导入。');
      await this.transact('刷新招聘信息', d => Object.assign(d, P.merge(d, input)));
    } catch (e) { this.notice(e); }
    finally { this.importing = false; this.refreshRoots(); }
  }
  editCompanyNotes(target, editBusiness = false, onSaved) {
    const company = this.data.companies.find(c => c.id === target.id);
    if (!company) return this.notice('企业记录已变化，请刷新后重试。');
    const before = {notes: company.notes || '', business: company.business || ''};
    const fields = [{key: 'notes', label: '备注', type: 'textarea', value: before.notes}];
    if (editBusiness) fields.unshift({key: 'business', label: '业务一句话', value: before.business});
    return this.form(`企业备注 · ${company.name}`, fields, async values => {
      await this.transact('编辑企业备注', d => {
        const current = d.companies.find(c => c.id === company.id);
        if (!current) throw new Error('企业记录已变化，请重新打开备注。');
        if ((current.notes || '') !== before.notes || (editBusiness && (current.business || '') !== before.business)) throw new Error('备注已在其他位置更新，请重新打开后再保存。');
        current.notes = R.text(values.notes);
        if (editBusiness) current.business = R.text(values.business);
      });
      onSaved?.();
    }, '记录关注原因、投递提醒或个人判断。留空保存可清除备注；保存后可用“撤销”退回。');
  }
  async toggleWish(id) { return this.transact('更新心愿单', d => {
    const c = d.companies.find(x => x.id === id);
    if (!c) throw new Error('未找到该企业，请刷新后重试。');
    if (c.archived) throw new Error('该企业已归档，请先还原后修改关注状态。');
    c.wish = !c.wish;
  }); }
  async setCompanyArchived(id, archived) {
    return this.transact(archived ? '归档企业' : '还原企业', d => {
      const c = d.companies.find(x => x.id === id);
      if (!c) throw new Error('未找到该企业，请刷新后重试。');
      c.archived = !!archived;
      if (archived) c.archivedAt = day(); else delete c.archivedAt;
    });
  }
  async toggleJobPinned(job) {
    await this.transact('切换岗位置顶', d => {
      const current = d.jobs.find(j => j.id === job.id);
      if (!current) throw new Error('未找到该岗位，请刷新后重试。');
      if (current.archived) throw new Error('该岗位已归档，请先还原后置顶。');
      if (P.isApplied(current)) throw new Error('该岗位已投递，请在投递视图查看。');
      current.pinned = !current.pinned;
      if (current.pinned) current.pinnedAt = new Date().toISOString(); else delete current.pinnedAt;
    });
    for (const ui of this.roots) if (!ui.dead && ui.tab === '岗位') { ui.page = 0; ui.renderList(); }
  }
  async setJobArchived(id, archived) {
    const result = await this.transact(archived ? '归档岗位' : '还原岗位', d => {
      const job = d.jobs.find(j => j.id === id);
      if (!job) throw new Error('未找到该岗位，请刷新后重试。');
      if (!!job.archived !== !!archived) {
        job.archived = !!archived;
        if (archived) job.archivedAt = day(); else delete job.archivedAt;
      }
      const company = d.companies.find(c => c.id === job.companyId);
      return {view: P.jobTab(job), companyArchived: !!company?.archived, companyWished: !!company?.wish};
    }, {skipUnchanged: true});
    if (!archived && result.view === '岗位') {
      if (result.companyArchived) new ob.Notice('岗位已还原。企业仍已归档，请在“已归档企业”还原企业后查看。', 6000);
      else if (!result.companyWished) new ob.Notice('岗位已还原。请将企业加入心愿单后，在“岗位”查看。', 6000);
    }
    return result;
  }
  async importResearchFile(file) {
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (envelope.options?.kind === 'job-draft') return this.saveJobDraft(envelope.payload);
    return this.saveResearch(envelope.payload, envelope.options || {});
  }
  async browserCaptureRequestFile(file) {
    const request = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (request.action === 'context') {
      await this.reloadData();
      return {schema: 1, vault: this.app.vault.getName(), module: this.manifest.version,
        companies: this.data.companies.map(c => ({id: c.id, name: c.name, labels: B.labels(c), wish: !!c.wish, archived: !!c.archived})),
        jobs: this.data.jobs.map(j => ({companyId: j.companyId, name: j.name, batch: j.batch, stage: j.stage, url: j.url, archived: !!j.archived}))};
    }
    if (request.action === 'preview') { await this.reloadData(); return B.preview(this.data, B.normalize(request.payload)); }
    if (request.action === 'save') return this.saveBrowserJob(request.payload);
    if (request.action === 'undo') {
      if (!/^[a-f0-9]{64}$/.test(request.token || '')) throw new Error('撤销凭证无效。');
      await this.undo(request.token); return {undone: true};
    }
    if (request.action === 'open') {
      const job = this.data.jobs.find(j => j.id === request.jobId);
      this.currentTab = P.jobTab(job);
      await this.openPanel();
      for (const ui of this.roots) ui.selectTab(this.currentTab);
      return {opened: true};
    }
    throw new Error('不支持的浏览器操作。');
  }
  async saveBrowserJob(payload) {
    const input = B.normalize(payload);
    const result = await this.transact('保存浏览器岗位', d => {
      const beforeState = JSON.stringify(d);
      let company = B.company(d, input.company), newCompany = !company;
      if (!company) {
        company = {id: 'company-' + hash(R.companyKey(input.company.name)).slice(0, 16), name: input.company.name, aliases: [input.company.name], recordIds: [], wish: false, notes: '', 索引: [`[[${TOPIC}]]`]};
        d.companies.push(company);
      }
      if (company.archived && !input.restoreArchived) throw new Error('该企业已归档，请在预览中勾选“还原企业后保存”。');
      if (company.archived) { company.archived = false; delete company.archivedAt; }
      company.wish = true;
      const source = {url: input.url, title: input.title || input.name, evidence: input.evidence || '用户在浏览器预览后保存的具体岗位；未填写字段待核实。'};
      let job = B.existing(d, company.id, input), added = 0, supplemented = 0;
      if (job) {
        for (const key of ['batch', 'location', 'url', 'requirements', 'responsibilities']) if (!job[key] && input[key]) { job[key] = input[key]; supplemented++; }
        job.sources = R.sources([...(job.sources || []), source]);
        job.browserCapture = {...job.browserCapture, urls: [...new Set([...(job.browserCapture?.urls || []), input.url])]};
      } else {
        job = {id: 'job-' + crypto.randomBytes(8).toString('hex'), companyId: company.id, name: input.name, batch: input.batch,
          location: input.location, url: input.url, requirements: input.requirements, responsibilities: input.responsibilities,
          notes: input.notes, deadline: '', stage: '待准备', appliedDate: '', resume: '', sources: R.sources([source]),
          graduateStatus: '待核实', createdAt: day(), browserCapture: {urls: [input.url], savedAt: day()}, 索引: [`[[${TOPIC}]]`]};
        d.jobs.push(job); added = 1;
      }
      return {companyId: company.id, company: company.name, name: job.name, jobId: job.id, newCompany, added, skipped: added ? 0 : 1,
        supplemented, stage: job.stage, view: P.jobTab(job), changed: JSON.stringify(d) !== beforeState};
    }, {skipUnchanged: true});
    const last = this.settings.undo?.at(-1);
    return {...result, undoToken: last && result.changed ? hash(last) : ''};
  }
  async saveJobDraft(payload) {
    const body = R.text(payload?.body), jobId = R.text(payload?.jobId), resume = R.text(payload?.resume);
    if (!jobId || !resume || !P.draftText(body)) throw new Error('文案需包含岗位 ID、绑定简历路径及“# 可直接使用的文案”正文。');
    if (body.startsWith('---') || body.length > 100000) throw new Error('文案正文请省略属性区，长度不超过十万字。');
    return this.transact('保存岗位文案', async (d, tx) => {
      const j = d.jobs.find(x => x.id === jobId);
      if (!j) throw new Error('未找到对应岗位。');
      if (j.resume !== resume) throw new Error('绑定简历已变化，请基于当前版本重新核对文案。');
      if (!this.app.vault.getAbstractFileByPath(resume)) throw new Error('绑定简历文件已不存在，请重新绑定。');
      const c = d.companies.find(x => x.id === j.companyId);
      const label = `${c?.name || '企业'}-${j.name}`.replace(/[\\/:*?"<>|#\[\]]/g, '-').slice(0, 55);
      const rel = `工作投递/AI结果/投递文案-${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.md`;
      await tx.addFile(rel, `---\n所在文件夹:\n类型: AI内容\n复核状态: 待看\n来源: AI生成\n索引:\n  - "[[${TOPIC}]]"\n关联岗位ID: ${JSON.stringify(jobId)}\n绑定简历: ${JSON.stringify(`[[${resume}]]`)}\n写入日期: ${day()}\n目标去向: 待判断\n摘要: ${JSON.stringify('用于 ' + (c?.name || '') + ' · ' + j.name + ' 的投递文案')}\n---\n\n${body}\n`);
      j.draftNote = rel; j.draftDate = day(); j.draftResume = resume;
      return {jobId, note: rel, resume, copiedCharacters: P.draftText(body).length};
    });
  }
  async copyJobDraft(job) {
    const j = this.data.jobs.find(x => x.id === job.id), f = j?.draftNote && this.app.vault.getAbstractFileByPath(j.draftNote);
    if (!f) throw new Error('请先执行文案优化任务并保存结果。');
    const text = P.draftText(await this.app.vault.read(f));
    if (!text) throw new Error('文案中缺少“可直接使用的文案”小节，请打开结果核对。');
    require('electron').clipboard.writeText(text); this.notice('已复制文案，请核对后用于当前岗位。');
  }
  async saveResearch(payload, options = {}) {
    const kind = options.kind || 'ai-research';
    if (!['ai-research', 'screenshot'].includes(kind)) throw new Error('不支持的岗位来源类型。');
    if (options.saveJobs && kind !== 'screenshot') throw new Error('AI 调研岗位需在视图中勾选；截图岗位可直接保存。');
    const images = [];
    for (const file of options.screenshotPaths || []) {
      const bytes = fs.readFileSync(file), ext = path.extname(file).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('截图需为 PNG、JPEG 或 WebP 图片。');
      if (bytes.length > 20 * 1024 * 1024) throw new Error('单张岗位截图最多20 MB。');
      const valid = ext === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : ext === '.webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!valid) throw new Error('截图格式与扩展名不符。');
      const rel = `工作投递/附件/岗位截图-${hash(bytes).slice(0, 24)}${ext === '.jpeg' ? '.jpg' : ext}`;
      if (!images.some(x => x.rel === rel)) images.push({rel, bytes});
    }
    if (kind === 'screenshot' && !images.length) throw new Error('截图保存需要提供原始图片。');
    return this.transact(kind === 'screenshot' ? '保存截图岗位' : '保存 AI 调研', async (d, tx) => {
      const requested = payload?.company || {}, name = R.text(requested.name);
      const normalized = R.companyKey;
      let company;
      if (requested.id) company = d.companies.find(c => c.id === requested.id);
      else {
        if (!name) throw new Error('请明确企业名称。');
        const matches = d.companies.filter(c => [c.name, ...(c.aliases || [])].some(v => normalized(v) === normalized(name)));
        if (matches.length > 1) throw new Error('企业名称对应多条记录，请使用明确的企业 ID。');
        company = matches[0];
      }
      if (!company) {
        if (requested.id || !name) throw new Error('未找到指定企业，请核对名称或 ID。');
        company = {id: 'company-' + hash(normalized(name)).slice(0, 16), name, aliases: [name], recordIds: [], wish: false, notes: '', 索引: [`[[${TOPIC}]]`]};
        d.companies.push(company);
      }
      const refs = images.map(x => ({attachment: x.rel, title: '用户提供的岗位截图', evidence: '按原图可见内容提取；缺失信息待核实'}));
      const report = R.normalize(payload, company.id, kind, refs);
      if (kind === 'screenshot' && !report.candidates.length) throw new Error('截图中未识别到明确的具体岗位，未创建记录。');
      R.save(d, company, report);
      for (const image of images) if (!await this.app.vault.adapter.exists(image.rel)) await tx.addBinary(image.rel, image.bytes);
      let result = {added: 0, skipped: 0, supplemented: 0};
      if (options.saveJobs) { company.wish = true; result = R.add(d, company.id, report.candidates.map(j => j.id), true); }
      return {companyId: company.id, company: company.name, candidates: report.candidates.length, ...result, attachments: images.map(x => x.rel)};
    });
  }
  async addCandidates(companyId, ids) {
    if (!ids.length) throw new Error('请先勾选岗位。');
    const result = await this.transact('添加选中岗位', d => {
      if (!d.companies.find(c => c.id === companyId)?.wish) throw new Error('该企业已取消关注，请重新加入心愿单。');
      return R.add(d, companyId, ids);
    });
    this.notice(`已添加 ${result.added} 个岗位${result.skipped ? `，跳过 ${result.skipped} 个已有岗位` : ''}`);
    this.showJobs(); return result;
  }
  showJobs() {
    this.currentTab = '岗位';
    for (const ui of this.roots) { ui.tab = '岗位'; ui.filter = '全部'; ui.query = ''; ui.search.value = ''; ui.page = 0; ui.refresh(); }
  }
  form(title, fields, submit, description = '', saveText = '保存') { const m = new FormModal(this.app, title, fields, submit, description, saveText); m.open(); return m; }
  newJob(company, source) {
    if (this.data.companies.find(c => c.id === company.id)?.archived) return this.notice('该企业已归档，请先还原后添加岗位。');
    if (!this.data.companies.find(c => c.id === company.id)?.wish) return this.notice('先把企业加入心愿单，再添加具体岗位。');
    if ((this.data.candidateJobs || []).some(j => j.companyId === company.id)) {
      const modal = new CandidatePickerModal(this, company, source); modal.open(); return modal;
    }
    return this.manualJob(company, source);
  }
  manualJob(company, source) {
    if (this.data.companies.find(c => c.id === company.id)?.archived) return this.notice('该企业已归档，请先还原后添加岗位。');
    if (!this.data.companies.find(c => c.id === company.id)?.wish) return this.notice('先把企业加入心愿单，再添加具体岗位。');
    const plans = this.data.records.filter(r => r.companyId === company.id && r.sheet === '投递信息');
    const selected = source || plans[0], f = selected?.fields || {};
    this.form(`添加岗位 · ${company.name}`, [
      {key: 'name', label: '岗位名称', required: true, value: ''},
      ...(plans.length > 1 ? [{key: 'sourceId', label: '所属招聘计划', type: 'select', value: selected.id,
        options: plans.map((r, i) => ({value: r.id, text: `${i + 1}. ${r.fields['招聘计划/岗位'] || '招聘计划'}`})),
        change: (id, inputs) => { const r = plans.find(r => r.id === id); inputs.url.value = r?.links['投递入口'] || ''; inputs.location.value = r?.fields['工作地点'] || ''; }}] : []),
      {key: 'batch', label: '招聘批次', value: '2027届校招'},
      {key: 'location', label: '工作地点', value: f['工作地点'] || company.research?.locations?.join('、') || ''},
      {key: 'url', label: '岗位／投递入口', value: selected?.links['投递入口'] || company.research?.applicationUrl || ''},
      {key: 'requirements', label: '岗位要求', type: 'textarea', value: ''},
      {key: 'deadline', label: '已确认的截止日期', type: 'date', value: ''},
      {key: 'notes', label: '选择理由或待确认问题', type: 'textarea', value: ''},
    ], async values => this.transact('添加目标岗位', d => {
      if (d.companies.find(c => c.id === company.id)?.archived) throw new Error('该企业已归档，请先还原后添加岗位。');
      if (!d.companies.find(c => c.id === company.id)?.wish) throw new Error('该企业已取消关注；请重新加入心愿单后添加岗位。');
      const duplicate = d.jobs.find(j => j.companyId === company.id && R.jobKey(j) === R.jobKey(values));
      if (duplicate) throw new Error('这个企业、岗位和批次已有记录，请打开原岗位。');
      d.jobs.push({...values, id: 'job-' + crypto.randomBytes(8).toString('hex'), companyId: company.id,
        sourceId: values.sourceId || selected?.id || '', stage: '待准备', appliedDate: '', resume: '', createdAt: day(), 索引: [`[[${TOPIC}]]`]});
    }).then(() => this.showJobs()), `记录「${company.name}＋具体岗位」。保存后进入“岗位”视图。${company.research ? '' : '调研结果保存后，这里支持勾选添加。'}`);
  }
  editJob(job) {
    const c = this.data.companies.find(c => c.id === job.companyId);
    this.form('编辑岗位', [
      {key: 'name', label: '岗位名称', required: true, value: job.name},
      {key: 'batch', label: '招聘批次', value: job.batch},
      {key: 'location', label: '工作地点', value: job.location},
      {key: 'url', label: '投递入口', value: job.url},
      {key: 'requirements', label: '岗位要求', type: 'textarea', value: job.requirements || ''},
      {key: 'deadline', label: '已确认的截止日期', type: 'date', value: job.deadline?.slice(0, 10)},
      {key: 'stage', label: '投递阶段', type: 'select', options: STAGES, value: job.stage},
      {key: 'appliedDate', label: '实际投递日期', type: 'date', value: job.appliedDate},
      {key: 'notes', label: '个人备注', type: 'textarea', value: job.notes},
    ], async values => this.transact('编辑岗位', d => {
      if (!['待准备', '待投递'].includes(values.stage) && !values.appliedDate) throw new Error('请填写实际投递日期；未投递的岗位应处于待准备或待投递。');
      if (d.jobs.some(j => j.id !== job.id && j.companyId === job.companyId && R.jobKey(j) === R.jobKey(values))) throw new Error('同一企业、岗位和批次已有记录。');
      Object.assign(d.jobs.find(j => j.id === job.id), values);
    }), `企业：${c?.name || ''}`);
  }
  async setStage(job, stage) {
    if (!['待准备', '待投递'].includes(stage) && !job.appliedDate) {
      return this.form('记录实际投递', [{key: 'appliedDate', label: '投递日期', type: 'date', value: day(), required: true}],
        async v => this.transact('记录投递', async (d, tx) => {
          Object.assign(d.jobs.find(j => j.id === job.id), {stage, appliedDate: v.appliedDate});
          await tx.diary(`- 已投递：${this.company(job).name} · ${job.name}（投递日期 ${v.appliedDate}）`);
        }), '该操作记录已经完成的投递。');
    }
    await this.transact('更新投递阶段', d => { d.jobs.find(j => j.id === job.id).stage = stage; });
  }
  company(job) { return this.data.companies.find(c => c.id === job.companyId) || {name: '待核实企业'}; }
  jobAiDialog(target, kind) {
    const job = this.data.jobs.find(j => j.id === target.id);
    if (!job) return this.notice('岗位记录已变化，请刷新后重试。');
    if (!job.resume || !this.app.vault.getAbstractFileByPath(job.resume)) {
      this.notice('先绑定本次使用的简历，选好后继续。');
      return this.pickResume(job, () => this.jobAiDialog(job, kind));
    }
    if (kind === '填写' && !safeUrl(job.url)) {
      return this.form('补充投递入口', [{key: 'url', label: '当前岗位的招聘网页', required: true, value: ''}],
        async v => { await this.transact('补充岗位入口', d => { d.jobs.find(j => j.id === job.id).url = v.url; }); this.jobAiDialog(job, kind); },
        '填写任务需要明确的招聘网页。保存入口后继续。', '保存并继续');
    }
    const optimizing = kind === '优化', name = `${this.company(job).name} · ${job.name}`;
    return this.form(optimizing ? '优化岗位文案' : '辅助填写 · 试用', optimizing ? [
      {key: 'focus', label: '这次准备什么', type: 'select', options: ['自我介绍', '申请动机', '项目经历', '简历表述', '其他网申问题'], value: '自我介绍'},
      {key: 'original', label: '现有文案或网申题目（可留空）', type: 'textarea', value: ''},
      {key: 'length', label: '篇幅或语言要求', value: '中文，200字以内'},
    ] : [
      {key: 'mode', label: '辅助方式', type: 'select', options: ['准备可复制的填写内容', '尝试填写招聘网页'], value: '准备可复制的填写内容'},
      {key: 'question', label: '要填写的字段或遇到的问题（可留空）', type: 'textarea', value: ''},
    ], async values => this.transact(optimizing ? '添加文案优化任务' : '添加辅助填写任务', async (d, tx) => {
      const current = d.jobs.find(j => j.id === job.id);
      if (!current || current.resume !== job.resume) throw new Error('绑定简历已变化，请重新打开任务。');
      const oneLine = v => R.text(v).replace(/\s+/g, ' ');
      const context = `${name}（${current.batch || '批次待核实'}）；岗位ID：${current.id}；绑定简历：[[${current.resume}]]；岗位入口：${safeUrl(current.url) || '待补充'}`;
      const request = optimizing ? `优化岗位文案：${context}；内容：${oneLine(values.focus)}；篇幅／语言：${oneLine(values.length) || '按问题要求'}；现有文案／题目：${oneLine(values.original) || '基于已核实经历起草'}`
        : `辅助网申填写（试用）：${context}；辅助方式：${oneLine(values.mode)}；字段／问题：${oneLine(values.question) || '先识别网页字段或整理常见网申内容'}；基于绑定简历与该岗位要求准备内容，缺失事实列为待补充，完成后由我检查并提交`;
      await tx.diary(`- [ ] ${request}；按 [[07-岗位文案与网申辅助模板]] 执行并回写文案结果；遵守 [[工作投递管理规则]] #AI`);
    }), `${name}\n使用绑定简历：${job.resume.split('/').pop().replace(/\.md$/, '')}。${optimizing ? '结果用于当前岗位，保留真实经历。' : '可准备填写内容，或尝试在指定招聘页面填写，完成后由你检查并提交。'}此入口先生成今天日记中的待执行 AI 任务。`, optimizing ? '生成优化任务' : '生成填写任务');
  }
  addDiaryDialog(target, kind) {
    const name = target.companyId ? `${this.company(target).name} · ${target.name}` : target.name;
    const ai = kind === '调研' || kind === '匹配';
    const researchLinks = target.companyId ? [safeUrl(target.url)] : [safeUrl(target.research?.applicationUrl), ...this.data.records.filter(r => r.companyId === target.id).flatMap(r => [safeUrl(r.links['投递入口']), safeUrl(r.links['原文链接'])])];
    const evidence = [...new Set(researchLinks.filter(Boolean))].slice(0, 3).join('；') || '在工作投递模块中核实';
    const suggestion = kind === '调研' ? `调研 ${name} 的官方校招投递入口（企业ID：${target.companyId || target.id}）。主要完成标准：核实企业归属与校招路径，保留官方来源、依据和核实日期；按 [[06-企业岗位调研模板]] 将入口写入工作投递 JSON 的 applicationUrl，确认在“投递入口”列显示且可打开。先完成入口保存；岗位调研为可选补充，不作为强制完成指标，没有岗位时 candidates: [] 也可保存。入口未核实时说明缺口并保留主任务待办。来源线索：${evidence}；遵守 [[工作投递管理规则#AI 调研目标与完成标准]]`
      : kind === '匹配' ? `对照 [[${target.resume || RESUME}]] 分析 ${name}（${target.batch || '批次待确认'}）的硬性条件、经历证据和缺口。岗位ID：${target.id}；岗位入口：${safeUrl(target.url) || '在工作投递模块中核实'}。按 [[05-岗位匹配分析模板]] 输出到 工作投递/AI结果；遵守 [[工作投递管理规则]]`
      : kind === '反馈' ? '' : `跟进 ${name}`;
    this.form(kind === '反馈' ? '记录反馈' : ai ? '交给 AI 的任务' : '安排跟进', [
      {key: 'text', label: '内容', type: 'textarea', value: suggestion, required: true},
      ...(!ai && kind !== '反馈' ? [{key: 'due', label: '计划日期', type: 'date', value: day()}] : []),
    ], async v => this.transact(kind === '反馈' ? '记录反馈' : '添加日记任务', async (d, tx) => {
      const line = kind === '反馈' ? `- ${name}：${v.text.replace(/\n/g, ' ')}` : `- [ ] ${v.text.replace(/\n/g, ' ')}${ai ? ' #AI' : ''}${v.due ? ' 📅 ' + v.due : ''}`;
      await tx.diary(line);
      if (target.companyId && kind === '反馈') { const j = d.jobs.find(j => j.id === target.id); j.lastFeedback = v.text; j.feedbackDate = day(); }
    }), ai ? '任务写入今天日记，确认后再由 AI 执行。' : '写入今天日记中“工作投递管理系统”的主题小节。');
  }
  pickResume(job, onBound) {
    const p = this;
    class Picker extends ob.FuzzySuggestModal {
      getItems() { return p.app.vault.getMarkdownFiles().filter(f => /简历/.test(f.name) && !f.path.startsWith('回收站/')); }
      getItemText(f) { return f.basename + ' · ' + f.path; }
      onChooseItem(f) { p.transact('绑定简历', d => { d.jobs.find(j => j.id === job.id).resume = f.path; }).then(() => onBound?.()).catch(() => {}); }
    }
    const m = new Picker(this.app); m.setPlaceholder(onBound ? '先选择简历，绑定后继续准备 AI 任务' : '选择本次投递使用的简历'); m.open();
  }
  resumeVersion(job) {
    this.form('新建简历版本', [{key: 'title', label: '文件名', value: `简历-${this.company(job).name}-${job.name}`, required: true}], async v => {
      const title = v.title.replace(/[\\/:*?"<>|#\[\]]/g, '-').trim(), rel = `工作投递/简历/${title}.md`;
      if (await this.app.vault.adapter.exists(rel)) throw new Error('同名简历已存在，请改名或选择已有版本。');
      const raw = await this.app.vault.adapter.read(RESUME);
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      await this.transact('建立简历版本', async (d, tx) => {
        await tx.addFile(rel, `---\n所在文件夹: 笔记\n索引:\n  - "[[${TOPIC}#简历管理]]"\n日期: ${day()}\n摘要: ${JSON.stringify('用于 ' + this.company(job).name + ' · ' + job.name)}\n归档: false\n---\n\n${body}`);
        d.jobs.find(j => j.id === job.id).resume = rel;
      }); this.openNote(rel);
    }, '复制基础简历供你编辑，并关联到当前岗位。');
  }
  rollbackDialog() {
    this.notice('如需卸载，请关闭 Obsidian 后运行下载包内的卸载入口；就业数据与个人文件会保留。');
  }

}

let JobView, FormModal, CandidatePickerModal;
if (ob) {
  JobView = class extends ob.ItemView {
    constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
    getViewType() { return VIEW; }
    getDisplayText() { return '工作投递'; }
    getIcon() { return 'briefcase-business'; }
    async onOpen() { this.plugin.mount({container: this.contentEl, component: this}); }
  };
  FormModal = class extends ob.Modal {
    constructor(app, title, fields, submit, desc, saveText) { super(app); Object.assign(this, {titleText: title, fields, submit, desc, saveText}); }
    onOpen() {
      this.titleEl.setText(this.titleText); this.contentEl.addClass('kja-form');
      if (this.desc) this.contentEl.createEl('p', {text: this.desc, cls: 'kja-muted'});
      const values = {}, first = [];
      for (const f of this.fields) {
        const row = this.contentEl.createEl('label', {cls: 'kja-field'});
        row.createSpan({text: f.label + (f.required ? ' *' : '')});
        const el = f.type === 'textarea' ? row.createEl('textarea') : f.type === 'select' ? row.createEl('select') : row.createEl('input', {type: f.type || 'text'});
        if (f.options) for (const o of f.options) el.createEl('option', typeof o === 'string' ? {value: o, text: o} : o);
        el.value = f.value || ''; values[f.key] = el; first.push(el);
        if (f.change) el.onchange = () => f.change(el.value, values);
      }
      const error = this.contentEl.createDiv({cls: 'kja-error', attr: {role: 'alert'}}), actions = this.contentEl.createDiv({cls: 'kja-form-actions'});
      actions.createEl('button', {text: '取消'}).onclick = () => this.close();
      const save = actions.createEl('button', {text: this.saveText || '保存', cls: 'mod-cta'});
      const doSubmit = async () => {
        const v = {}; error.setText('');
        for (const f of this.fields) {
          v[f.key] = values[f.key].value.trim();
          if (f.required && !v[f.key]) { error.setText('请填写：' + f.label); values[f.key].focus(); return; }
          if (f.type === 'date' && v[f.key] && !/^\d{4}-\d{2}-\d{2}$/.test(v[f.key])) { error.setText('日期格式应为 YYYY-MM-DD'); return; }
        }
        if (v.url && !safeUrl(v.url)) return error.setText('入口需使用有效的 http 或 https 网址。');
        save.disabled = true;
        try { await this.submit(v); this.close(); } catch (e) { error.setText(e.message); save.disabled = false; }
      };
      save.onclick = doSubmit;
      this.contentEl.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
      setTimeout(() => first[0]?.focus(), 50);
    }
  };
  CandidatePickerModal = class extends ob.Modal {
    constructor(plugin, company, source) { super(plugin.app); Object.assign(this, {plugin, company, source}); this.selected = new Set(); }
    onOpen() {
      this.modalEl.addClass('kja-picker-modal'); this.contentEl.addClass('kja-picker');
      this.titleEl.setText(`添加岗位 · ${this.company.name}`);
      this.contentEl.createEl('p', {text: '勾选调研岗位，一次添加。地点、入口和要求会一起保存。', cls: 'kja-muted'});
      const toolbar = this.contentEl.createDiv({cls: 'kja-picker-toolbar'});
      this.search = toolbar.createEl('input', {type: 'search', placeholder: '搜索岗位、地点或要求', attr: {'aria-label': '筛选调研岗位'}});
      this.filter = toolbar.createEl('select', {attr: {'aria-label': '岗位范围'}});
      for (const text of ['可添加岗位', '应届生岗位', '全部岗位']) this.filter.createEl('option', {value: text, text});
      this.search.oninput = this.filter.onchange = () => this.render();
      const quick = this.contentEl.createDiv({cls: 'kja-picker-quick'});
      const all = quick.createEl('button', {text: '勾选当前结果'});
      all.onclick = () => { for (const j of this.visible) if (!this.existing(j)) this.selected.add(j.id); this.render(); };
      quick.createEl('button', {text: '清空勾选'}).onclick = () => { this.selected.clear(); this.render(); };
      this.count = quick.createSpan({cls: 'kja-muted', attr: {'aria-live': 'polite'}});
      this.list = this.contentEl.createDiv({cls: 'kja-candidate-list'});
      this.error = this.contentEl.createDiv({cls: 'kja-error', attr: {role: 'alert'}});
      const actions = this.contentEl.createDiv({cls: 'kja-picker-actions'});
      actions.createEl('button', {text: '手动填写岗位'}).onclick = () => { this.close(); this.plugin.manualJob(this.company, this.source); };
      const right = actions.createDiv({cls: 'kja-actions'});
      right.createEl('button', {text: '取消'}).onclick = () => this.close();
      this.save = right.createEl('button', {text: '添加选中岗位', cls: 'mod-cta'});
      this.save.onclick = async () => {
        if (this.saving || !this.selected.size) return;
        this.saving = true; this.save.disabled = true; this.error.setText('');
        try { await this.plugin.addCandidates(this.company.id, [...this.selected]); this.close(); }
        catch (e) { this.error.setText(e.message); this.saving = false; this.render(); }
      };
      this.render(); this.search.focus();
    }
    existing(j) { return this.plugin.data.jobs.find(x => x.companyId === j.companyId && R.jobKey(x) === R.jobKey(j)); }
    render() {
      const all = (this.plugin.data.candidateJobs || []).filter(j => j.companyId === this.company.id);
      const query = this.search.value.toLocaleLowerCase().trim();
      this.visible = all.filter(j => (!query || `${j.name} ${j.batch} ${j.location} ${j.requirements}`.toLocaleLowerCase().includes(query))
        && (this.filter.value === '全部岗位' || !this.existing(j)) && (this.filter.value !== '应届生岗位' || j.graduateStatus === '应届生'))
        .sort((a, b) => Number(a.graduateStatus !== '应届生') - Number(b.graduateStatus !== '应届生') || a.name.localeCompare(b.name, 'zh-CN'));
      for (const id of this.selected) if (!all.some(j => j.id === id && !this.existing(j))) this.selected.delete(id);
      this.list.empty();
      if (!this.visible.length) this.list.createDiv({text: all.some(j => !this.existing(j)) ? '没有匹配的岗位，试试清空搜索或切换范围。' : '调研岗位已全部加入。可查看全部岗位，或手动填写其他岗位。', cls: 'kja-picker-empty'});
      for (const j of this.visible) {
        const previous = this.existing(j), card = this.list.createDiv({cls: 'kja-candidate-card'});
        card.toggleClass('is-selected', this.selected.has(j.id));
        const label = card.createEl('label', {cls: 'kja-candidate-heading'});
        const checkbox = label.createEl('input', {type: 'checkbox', attr: {'aria-label': '选择 ' + j.name}});
        checkbox.disabled = !!previous || !!this.saving; checkbox.checked = this.selected.has(j.id);
        const text = label.createDiv(); text.createEl('strong', {text: j.name});
        text.createDiv({text: [j.batch, j.location || '地点待核实'].filter(Boolean).join(' · '), cls: 'kja-muted'});
        label.createSpan({text: previous ? previous.archived ? '已归档岗位' : P.isApplied(previous) ? '已投递' : '已加入岗位' : j.graduateStatus === '应届生' ? '应届生' : j.graduateStatus === '非应届' ? '非应届' : '应届资格待核实', cls: 'kja-badge'});
        checkbox.onchange = () => {
          if (checkbox.checked) this.selected.add(j.id); else this.selected.delete(j.id);
          card.toggleClass('is-selected', checkbox.checked); this.updateCount();
        };
        if (j.requirements) card.createDiv({text: j.requirements, cls: 'kja-candidate-requirements'});
        else card.createDiv({text: '岗位要求待核实', cls: 'kja-muted'});
        const detail = card.createEl('details'); detail.createEl('summary', {text: '职责与来源'});
        if (j.responsibilities) detail.createEl('p', {text: j.responsibilities, cls: 'kja-candidate-requirements'});
        detail.createDiv({text: `${j.status} · 核实 ${j.checkedAt}${j.deadline ? ` · ${j.deadlineVerified ? '截止' : '截止待核实'} ${j.deadline}` : ''}`, cls: 'kja-muted'});
        if (safeUrl(j.url)) detail.createEl('a', {text: '投递入口 ↗', href: safeUrl(j.url), cls: 'kja-link', attr: {target: '_blank', rel: 'noopener noreferrer'}});
        for (const [i, ref] of (j.sources || []).entries()) {
          if (ref.url) detail.createEl('a', {text: ref.title || `来源 ${i + 1}`, href: safeUrl(ref.url), cls: 'kja-link', attr: {target: '_blank', rel: 'noopener noreferrer'}});
          if (ref.attachment) detail.createEl('button', {text: '查看原始截图', cls: 'kja-btn'}).onclick = () => this.plugin.openNote(ref.attachment);
          if (ref.evidence) detail.createDiv({text: ref.evidence, cls: 'kja-muted'});
        }
      }
      this.updateCount();
    }
    updateCount() {
      this.count.setText(`显示 ${this.visible.length} / ${ (this.plugin.data.candidateJobs || []).filter(j => j.companyId === this.company.id).length} 个 · 已选 ${this.selected.size} 个`);
      this.save.setText(this.selected.size ? `添加 ${this.selected.size} 个岗位` : '添加选中岗位');
      this.save.disabled = !!this.saving || !this.selected.size;
    }
  };
}

class Dashboard {
  constructor(plugin, root) { this.plugin = plugin; this.root = root; this.tab = plugin.currentTab || '企业'; this.query = ''; this.filter = '全部'; this.page = 0; this.limit = 30; }
  selectTab(tab) {
    this.plugin.currentTab = this.tab = tab;
    this.filter = '全部'; this.page = 0; this.query = ''; this.search.value = ''; this.refresh();
  }
  action(el, text, fn, cls = '', title = '') {
    const b = el.createEl('button', {text, cls: 'kja-btn ' + cls, attr: {'aria-label': title || text, title: title || text}});
    b.onclick = async () => { if (b.disabled) return; b.disabled = true; try { await fn(); } catch (e) { this.plugin.notice(e); } finally { if (b.isConnected) b.disabled = false; } };
    return b;
  }
  mount() {
    this.root.empty();
    const header = this.root.createDiv({cls: 'kja-header'}), left = header.createDiv();
    left.createEl('h2', {text: '工作投递'}); left.createDiv({text: '筛选企业，确认岗位，持续跟进。', cls: 'kja-muted'});
    const actions = header.createDiv({cls: 'kja-actions'});
    this.action(actions, '可视化网页 ↗', () => this.plugin.openVisualization(), 'mod-cta', '打开招聘会日程可视化网页');
    this.action(actions, '刷新 Excel', () => this.plugin.refreshExcel());
    this.undoButton = this.action(actions, '撤销', () => this.plugin.undo());
    this.action(actions, '规则', () => this.plugin.openNote('工作投递/说明/工作投递管理规则.md'));
    this.action(actions, '设置', () => { this.plugin.app.setting.open(); this.plugin.app.setting.openTabById(ID); });
    this.stats = this.root.createDiv({cls: 'kja-stats'});
    const tabs = this.root.createDiv({cls: 'kja-tabs', attr: {role: 'tablist'}}); this.tabButtons = {};
    for (const t of ['企业', '心愿单', '岗位', '投递', '简历', '已归档', '已归档岗位']) {
      const b = this.action(tabs, t === '已归档' ? '已归档企业' : t, () => this.selectTab(t), t === '已归档' ? 'kja-archive-tab' : t === '已归档岗位' ? 'kja-job-archive-tab' : '');
      b.setAttr('role', 'tab'); this.tabButtons[t] = b;
    }
    const toolbar = this.root.createDiv({cls: 'kja-toolbar'});
    this.search = toolbar.createEl('input', {type: 'search', placeholder: '搜索企业、岗位、地区或备注', attr: {'aria-label': '搜索企业或岗位'}});
    this.search.oninput = () => { this.query = this.search.value; this.page = 0; this.renderList(); };
    this.select = toolbar.createEl('select', {attr: {'aria-label': '筛选'}});
    this.select.onchange = () => { this.filter = this.select.value; this.page = 0; this.renderList(); };
    this.resultCount = toolbar.createSpan({cls: 'kja-muted'});
    this.prevTop = this.action(toolbar, '‹', () => { this.page--; this.renderList(); }, '', '上一页');
    this.nextTop = this.action(toolbar, '›', () => { this.page++; this.renderList(); }, '', '下一页');
    const grid = this.root.createDiv({cls: 'kja-grid'});
    this.main = grid.createDiv({cls: 'kja-main'});
    const aside = grid.createDiv({cls: 'kja-aside'});
    const dh = aside.createDiv({cls: 'kja-side-head'}); dh.createEl('h3', {text: '今天的行动'});
    this.action(dh, '写日记', () => this.writeDiary());
    this.diary = aside.createDiv({cls: 'kja-diary'});
    this.deadlines = aside.createDiv({cls: 'kja-deadlines'});
    this.foot = this.root.createDiv({cls: 'kja-footer'});
    this.refresh();
    // A new home panel may inherit the previous card's scroll position.
    setTimeout(() => { let e = this.root; for (let i = 0; e && i < 5; i++, e = e.parentElement) if (e.scrollTop) e.scrollTop = 0; }, 100);
  }
  async writeDiary() {
    const rel = `工作投递/日记/${day()}.md`;
    if (!await this.plugin.app.vault.adapter.exists(rel)) await this.plugin.transact('创建求职日记', async (d, tx) => {
      await tx.addFile(rel, `# 求职日记 ${day()}\n\n## 主线\n\n## 随记\n\n## 复盘\n`);
    });
    this.plugin.openNote(rel);
  }

  refresh() {
    if (this.dead) return;
    const d = this.plugin.data; this.stats.empty();
    const counters = [[P.filtered(d, '企业').length, '待选企业', '企业'], [P.filtered(d, '心愿单').length, '心愿企业', '心愿单'],
      [P.filtered(d, '岗位').length, '待投递岗位', '岗位'],
      [P.filtered(d, '投递', '', '进行中').length, '进行中的投递', '投递']];
    for (const [n, label, tab] of counters) {
      const b = this.action(this.stats, '', () => this.selectTab(tab), 'kja-stat');
      b.createEl('strong', {text: String(n)}); b.createSpan({text: label}); b.setAttr('aria-label', `${label} ${n}`);
    }
    for (const [t, b] of Object.entries(this.tabButtons)) { b.toggleClass('is-active', t === this.tab); b.setAttr('aria-selected', String(t === this.tab)); }
    const archived = P.filtered(d, '已归档').length;
    this.tabButtons['已归档'].setText(`已归档企业 ${archived}`);
    this.tabButtons['已归档'].setAttr('aria-label', `查看已归档企业 ${archived}`);
    const archivedJobs = P.filtered(d, '已归档岗位').length;
    this.tabButtons['已归档岗位'].setText(`已归档岗位 ${archivedJobs}`);
    this.tabButtons['已归档岗位'].setAttr('aria-label', `查看已归档岗位 ${archivedJobs}`);
    const filters = this.tab === '企业' ? ['全部', '有投递入口'] : this.tab === '心愿单' ? ['全部', '未添加岗位', '已添加岗位', '已投递'] : this.tab === '投递' ? ['全部', '进行中'] : this.tab === '岗位' ? ['全部', '待准备', '待投递'] : this.tab === '已归档岗位' ? ['全部', '未投递', '已投递'] : ['全部'];
    this.select.empty(); for (const x of filters) this.select.createEl('option', {value: x, text: this.tab === '心愿单' ? `${x}（${P.filtered(d, '心愿单', '', x).length}）` : x}); this.select.value = this.filter;
    this.undoButton.disabled = !this.plugin.settings.undo?.length || this.plugin.busy;
    this.foot.setText(`来源：Luna 维护的招聘 Excel · ${d.records.length} 条来源记录 · 刷新 ${d.meta?.readAt?.slice(0, 16).replace('T', ' ') || '待导入'} · ${d.meta?.unassignedRecordIds?.length || 0} 条活动／汇总信息保留在来源中`);
    this.renderList(); this.renderDiary(); this.renderDeadlines();
  }
  link(el, label, url) { const safe = safeUrl(url); return safe ? el.createEl('a', {text: label, href: safe, attr: {target: '_blank', rel: 'noopener noreferrer'}, cls: 'kja-link'}) : null; }
  entrances(el, company, records) {
    const choices = new Map();
    if (safeUrl(company.research?.applicationUrl)) choices.set(safeUrl(company.research.applicationUrl), '官方招聘入口');
    for (const r of records) { const url = safeUrl(r.links['投递入口']); if (url && !choices.has(url)) choices.set(url, r.fields['招聘计划/岗位'] || r.fields['活动名称'] || '招聘入口'); }
    for (const j of this.plugin.data.candidateJobs || []) if (j.companyId === company.id && safeUrl(j.url) && !choices.has(safeUrl(j.url))) choices.set(safeUrl(j.url), j.name);
    if (!choices.size) { el.createSpan({text: '—', cls: 'kja-muted', attr: {title: '原表暂无投递入口'}}); return; }
    if (choices.size === 1) { this.link(el, '投递入口 ↗', choices.keys().next().value); return; }
    this.action(el, `投递入口 · ${choices.size} ▾`, () => this.entrancePicker(company, choices), 'kja-entry-trigger', `选择 ${company.name} 的 ${choices.size} 个投递入口`);
  }
  entrancePicker(company, choices) {
    const modal = new ob.Modal(this.plugin.app);
    modal.modalEl.addClass('kja-entry-modal');
    modal.titleEl.setText(company.name + ' · 投递入口');
    const list = modal.contentEl.createDiv({cls: 'kja-entry-picker'});
    for (const [url, label] of choices) {
      const safe = safeUrl(url); if (!safe) continue;
      const link = list.createEl('a', {href: safe, cls: 'kja-entry-option', attr: {target: '_blank', rel: 'noopener noreferrer'}});
      link.createSpan({text: label, cls: 'kja-entry-title'});
      link.createSpan({text: '↗', cls: 'kja-entry-arrow', attr: {'aria-hidden': 'true'}});
      link.createSpan({text: new URL(safe).hostname, cls: 'kja-entry-domain'});
    }
    modal.open();
  }
  renderList() {
    this.jobMenu?.hide();
    const d = this.plugin.data; this.main.empty();
    if (this.tab === '简历') { this.prevTop.disabled = true; this.nextTop.disabled = true; return this.renderResumes(); }
    const rows = P.filtered(d, this.tab, this.query, this.filter), limit = this.limit;
    const last = Math.max(0, Math.ceil(rows.length / limit) - 1); this.page = Math.min(this.page, last);
    this.resultCount.setText(`${rows.length} 项 · ${this.page + 1}/${last + 1} 页`);
    this.prevTop.disabled = this.page === 0; this.nextTop.disabled = this.page === last;
    if (!rows.length) {
      const empty = this.main.createDiv({cls: 'kja-empty'});
      empty.createDiv({text: this.query ? '没有匹配的内容，试试企业简称或清空搜索。' : this.tab === '已归档岗位' ? (this.filter === '全部' ? '暂无归档岗位。在岗位的“···”菜单中选择“归档岗位”，之后可在这里查看、还原。' : `暂无${this.filter}的归档岗位。`) : this.tab === '已归档' ? '暂无归档企业。企业行最右侧的“归档”会将企业移到这里，可随时还原。' : this.tab === '岗位' ? '从心愿单选择企业，点“加岗位”记录具体岗位。已投递记录在“投递”中查看。' : this.tab === '心愿单' ? (this.filter === '全部' ? '在企业列表勾选“关注”，企业就会出现在这里。' : `没有符合“${this.filter}”的心愿企业。`) : this.tab === '投递' ? '完成投递后，在岗位行点“··· → 记录已投递”，记录就会出现在这里。' : this.filter === '全部' ? '暂无待选企业，已关注企业请到“心愿单”查看。' : '暂无符合筛选条件的企业。'});
      if (!this.query && this.tab === '岗位') this.action(empty, '去心愿单加岗位', () => this.selectTab('心愿单'), 'mod-cta');
      return;
    }
    if (this.tab === '岗位' || this.tab === '已归档岗位') { this.renderPreparationCards(rows.slice(this.page * limit, (this.page + 1) * limit), this.tab === '已归档岗位'); this.renderPager(last); return; }
    const wrap = this.main.createDiv({cls: 'kja-table-wrap'}), table = wrap.createEl('table', {cls: 'kja-table' + (['企业', '心愿单', '已归档'].includes(this.tab) ? ' kja-company-table' : '')});
    const head = table.createEl('thead').createEl('tr'), isCompany = ['企业', '心愿单', '已归档'].includes(this.tab), pending = this.tab === '岗位', archivedView = this.tab === '已归档';
    for (const x of isCompany ? [archivedView ? '原关注状态' : '关注', '企业', '招聘信息', '投递入口', '操作'] : ['企业／具体岗位', pending ? '准备状态' : '阶段', pending ? '简历' : '投递日期／简历', '投递入口', '操作']) head.createEl('th', {text: x});
    const body = table.createEl('tbody');
    for (const item of rows.slice(this.page * this.limit, (this.page + 1) * this.limit)) {
      const tr = body.createEl('tr');
      if (isCompany) {
        const cell = tr.createEl('td');
        if (archivedView) cell.createSpan({text: item.wish ? '已关注' : '未关注', cls: 'kja-muted'});
        else {
          const checkbox = cell.createEl('input', {type: 'checkbox', attr: {'aria-label': '关注 ' + item.name}}); checkbox.checked = !!item.wish;
          checkbox.onchange = async () => { checkbox.disabled = true; try { await this.plugin.toggleWish(item.id); } catch (_) { checkbox.checked = !checkbox.checked; checkbox.disabled = false; } };
        }
        const name = tr.createEl('td'); this.action(name, item.name, () => this.companyDetails(item), 'kja-name');
        if (this.tab === '心愿单') {
          const progress = P.companyProgress(d, item.id), badges = name.createDiv({cls: 'kja-company-progress'}), archivedCount = d.jobs.filter(j => j.companyId === item.id && j.archived).length;
          if (!progress.total && !archivedCount) badges.createSpan({text: '未添加岗位', cls: 'kja-company-status kja-progress-none', attr: {title: '还没有保存该企业的具体目标岗位；调研候选不计入。'}});
          if (archivedCount) badges.createSpan({text: `已归档 ${archivedCount}`, cls: 'kja-company-status kja-progress-archived', attr: {title: '归档岗位保留资料，不计入在用岗位进度；可在“已归档岗位”还原。'}});
          if (progress.pending) badges.createSpan({text: `待投递 ${progress.pending}`, cls: 'kja-company-status kja-progress-pending', attr: {title: '已添加、尚未实际投递的岗位数。'}});
          if (progress.applied) badges.createSpan({text: `已投递 ${progress.applied}`, cls: 'kja-company-status kja-progress-applied', attr: {title: '已进入投递流程的岗位数，包含已结束的历史投递。'}});
        }
        if (item.business) name.createDiv({text: item.business, cls: 'kja-muted'});
        if (item.notes) name.createDiv({text: item.notes, cls: 'kja-company-notes', attr: {title: item.notes}});
        if (archivedView) name.createDiv({text: '归档于 ' + (item.archivedAt || '日期未记录'), cls: 'kja-muted'});
        const records = d.records.filter(r => r.companyId === item.id), info = tr.createEl('td');
        const delivery = records.filter(r => r.sheet === '投递信息');
        const events = records.length - delivery.length;
        info.createDiv({text: `${delivery.length ? delivery.length + ' 条招聘' : ''}${delivery.length && events ? ' · ' : ''}${events ? events + ' 条活动' : ''}`, cls: 'kja-muted'});
        const locations = [...new Set([...delivery.map(r => r.fields['工作地点']), ...(item.research?.locations || [])].filter(Boolean))];
        if (locations.length) info.createDiv({text: locations.join('、').slice(0, 75), cls: 'kja-muted'});
        const candidateCount = (d.candidateJobs || []).filter(j => j.companyId === item.id).length;
        if (candidateCount) info.createDiv({text: `${candidateCount} 个调研岗位 · ${item.research?.checkedAt || '日期待核实'}`, cls: 'kja-muted'});
        this.entrances(tr.createEl('td', {cls: 'kja-entry-cell'}), item, records);
        const actions = tr.createEl('td').createDiv({cls: 'kja-row-actions kja-company-actions'});
        if (archivedView) {
          this.action(actions, '还原', () => this.plugin.setCompanyArchived(item.id, false), 'kja-company-action', `还原 ${item.name}，返回${item.wish ? '心愿单' : '企业'}`);
          this.action(actions, '备注', () => this.plugin.editCompanyNotes(item), 'kja-company-action', '查看或编辑 ' + item.name + ' 的备注');
        }
        else {
          if (this.tab === '心愿单') this.action(actions, '加岗位', () => this.plugin.newJob(item), 'kja-company-action', '添加 ' + item.name + ' 的具体岗位');
          this.action(actions, 'AI 调研', () => this.plugin.addDiaryDialog(item, '调研'), 'kja-company-action', 'AI 调研 ' + item.name + ' 的校招投递入口');
          this.action(actions, '备注', () => this.plugin.editCompanyNotes(item), 'kja-company-action', '查看或编辑 ' + item.name + ' 的备注');
          const archive = this.action(actions, '', () => this.plugin.setCompanyArchived(item.id, true), 'kja-archive-action', '归档 ' + item.name + '，保留资料并隐藏，可随时还原');
          ob.setIcon(archive, 'archive');
          archive.querySelector('svg')?.setAttribute('aria-hidden', 'true');
        }
      } else {
        const name = tr.createEl('td'); name.createDiv({text: this.plugin.company(item).name, cls: 'kja-muted'});
        this.action(name, item.name, () => this.plugin.editJob(item), 'kja-name');
        if (item.location) name.createDiv({text: item.location, cls: 'kja-muted'});
        const stageCell = tr.createEl('td'), stage = stageCell.createEl('select', {attr: {'aria-label': item.name + ' 的投递阶段'}});
        for (const s of pending ? STAGES.slice(0, 2) : STAGES.slice(2)) stage.createEl('option', {value: s, text: s}); stage.value = item.stage;
        stage.onchange = async () => { const next = stage.value; stage.value = item.stage; await this.plugin.setStage(item, next).catch(() => {}); };
        const details = tr.createEl('td'); if (!pending) details.createDiv({text: item.appliedDate || '日期待补充', cls: 'kja-muted'});
        this.action(details, item.resume ? '查看简历' : '关联简历', () => item.resume ? this.plugin.openNote(item.resume) : this.plugin.pickResume(item));
        const entry = tr.createEl('td', {cls: 'kja-entry-cell'});
        if (!this.link(entry, '投递入口 ↗', item.url)) entry.createSpan({text: '—', cls: 'kja-muted', attr: {title: '请在岗位详情中补充投递入口'}});
        const actions = tr.createEl('td').createDiv({cls: 'kja-row-actions'});
        if (pending) {
          this.action(actions, 'AI 匹配', () => this.plugin.addDiaryDialog(item, '匹配'));
          this.action(actions, '记录投递', () => this.plugin.setStage(item, '已投递'), 'mod-cta');
        } else {
          this.action(actions, '跟进', () => this.plugin.addDiaryDialog(item, '跟进'));
          this.action(actions, '反馈', () => this.plugin.addDiaryDialog(item, '反馈'));
          const more = this.action(actions, '···', () => this.openJobMenu(item, more), 'kja-job-table-overflow', '更多操作：' + item.name);
          more.setAttr('aria-haspopup', 'menu'); more.setAttr('aria-expanded', 'false');
        }
      }
    }
    this.renderPager(last);
  }
  renderPager(last) {
    const pager = this.main.createDiv({cls: 'kja-pager'});
    this.action(pager, '上一页', () => { this.page--; this.renderList(); }).disabled = this.page === 0;
    pager.createSpan({text: `${this.page + 1} / ${last + 1}`});
    this.action(pager, '下一页', () => { this.page++; this.renderList(); }).disabled = this.page === last;
  }
  renderPreparationCards(rows, archived = false) {
    const p = this.plugin, intro = this.main.createDiv({cls: 'kja-prep-intro'});
    intro.createEl('h3', {text: archived ? '已归档岗位' : '投递准备'});
    intro.createEl('p', {text: archived ? '保留原阶段、简历和文案；还原后回到岗位或投递。' : '绑定简历，打开投递；更多操作点 ···。'});
    const list = this.main.createDiv({cls: 'kja-prep-list'});
    for (const j of rows) {
      const card = list.createEl('article', {cls: 'kja-prep-card' + (archived ? ' is-archived' : j.pinned ? ' is-pinned' : ''), attr: {'aria-label': j.name, 'data-job-id': j.id}});
      const identity = card.createDiv({cls: 'kja-prep-identity'});
      if (!archived) {
        const pin = this.action(identity, '', () => p.toggleJobPinned(j), 'kja-prep-pin', (j.pinned ? '已置顶，点击取消：' : '未置顶，点击置顶：') + j.name);
        pin.setAttr('aria-pressed', String(!!j.pinned));
        ob.setIcon(pin, j.pinned ? 'pin' : 'pin-off');
        pin.querySelector('svg')?.setAttribute('aria-hidden', 'true');
      }
      this.action(identity, p.company(j).name, () => this.companyDetails(p.company(j)), 'kja-prep-company');
      this.action(identity, j.name, () => this.jobDetails(j), 'kja-prep-title', '查看完整岗位：' + j.name);
      const company = p.company(j), metadata = [archived ? j.stage : '', j.location || '地点待补充', j.batch, archived ? '归档 ' + (j.archivedAt || '日期未记录') : j.deadline ? '截止 ' + j.deadline : '', archived && company.archived ? '企业已归档' : archived && !company.wish && !P.isApplied(j) ? '企业未关注' : ''].filter(Boolean).join(' · ');
      card.createDiv({text: metadata, cls: 'kja-prep-meta', attr: {title: metadata}});
      const resume = card.createDiv({cls: 'kja-prep-resume'});
      const bound = j.resume && p.app.vault.getAbstractFileByPath(j.resume);
      if (bound) {
        const name = bound.basename || path.basename(j.resume, '.md');
        this.action(resume, name, () => p.openNote(j.resume), 'kja-resume-title', '查看绑定简历：' + name);
      } else if (archived) resume.createSpan({text: j.resume ? '简历文件缺失' : '未绑定简历', cls: 'kja-muted'});
      else this.action(resume, '绑定简历', () => p.pickResume(j), 'kja-bind-resume', j.resume ? '原绑定文件已不存在，请重新绑定简历' : '尚未绑定，选择本次投递使用的简历');
      const actions = card.createDiv({cls: 'kja-prep-actions'}), url = safeUrl(j.url);
      if (archived) this.action(actions, '还原岗位', () => p.setJobArchived(j.id, false), 'kja-restore-job', '还原岗位：' + j.name);
      else if (url) actions.createEl('a', {text: '打开投递 ↗', href: url, cls: 'kja-open-application', attr: {target: '_blank', rel: 'noopener noreferrer', title: url, 'aria-label': '打开 ' + j.name + ' 的投递网页'}});
      else this.action(actions, '补充链接', () => p.editJob(j), 'kja-bind-resume', '补充 ' + j.name + ' 的投递入口');
      const more = actions.createEl('button', {text: '···', cls: 'kja-btn kja-prep-overflow', attr: {title: '更多操作：' + j.name, 'aria-label': '更多操作：' + j.name, 'aria-haspopup': 'menu', 'aria-expanded': 'false'}});
      more.onclick = () => { try { this.openJobMenu(j, more); } catch (e) { p.notice(e); } };
    }
  }
  openJobMenu(job, button) {
    const p = this.plugin, j = p.data.jobs.find(x => x.id === job.id);
    if (!j) return p.notice('岗位已变化，请刷新后重试。');
    this.jobMenu?.hide();
    const menu = this.jobMenu = new ob.Menu(); menu.setUseNativeMenu(false);
    const add = (title, icon, fn) => menu.addItem(item => item.setTitle(title).setIcon(icon).setDisabled(!!p.busy).onClick(async () => { try { await fn(); } catch (e) { p.notice(e); } }));
    add('岗位要求与来源', 'file-text', () => this.jobDetails(j));
    add('编辑岗位', 'pencil', () => p.editJob(j));
    const bound = j.resume && p.app.vault.getAbstractFileByPath(j.resume);
    if (!j.archived) {
      add(bound ? '更换简历' : '绑定简历', 'file-user', () => p.pickResume(j));
      menu.addSeparator();
      add('AI 文案优化', 'sparkles', () => p.jobAiDialog(j, '优化'));
      add('AI 辅助填写 · 试用', 'list-plus', () => p.jobAiDialog(j, '填写'));
      add('AI 岗位匹配', 'scan-search', () => p.addDiaryDialog(j, '匹配'));
    }
    const draft = j.draftNote && p.app.vault.getAbstractFileByPath(j.draftNote);
    if (draft) {
      add(j.draftResume && j.draftResume !== j.resume ? '查看文案 · 简历已更换，待核对' : '查看岗位文案', 'file-text', () => p.openNote(j.draftNote));
      add('复制岗位文案', 'copy', () => p.copyJobDraft(j));
    }
    menu.addSeparator();
    if (!j.archived && !P.isApplied(j)) add('记录已投递', 'check', () => p.setStage(j, '已投递'));
    add(j.archived ? '还原岗位' : '归档岗位', j.archived ? 'archive-restore' : 'archive', () => p.setJobArchived(j.id, !j.archived));
    button.setAttr('aria-expanded', 'true');
    menu.onHide(() => { button.setAttr('aria-expanded', 'false'); if (this.jobMenu === menu) this.jobMenu = null; });
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({x: rect.right, y: rect.bottom + 4, left: true}, button.ownerDocument);
  }
  jobDetails(job) {
    const p = this.plugin, j = p.data.jobs.find(x => x.id === job.id);
    if (!j) return p.notice('岗位已变化，请刷新后重试。');
    const modal = new ob.Modal(p.app); modal.modalEl.addClass('kja-job-details-modal'); modal.contentEl.addClass('kja-job-details');
    modal.titleEl.setText(p.company(j).name + ' · ' + j.name);
    modal.contentEl.createDiv({text: [j.archived ? '已归档 ' + (j.archivedAt || '') : '', j.stage, j.location || '地点待补充', j.batch, j.deadline ? '截止 ' + j.deadline : ''].filter(Boolean).join(' · '), cls: 'kja-muted'});
    modal.contentEl.createEl('h3', {text: '岗位要求'});
    modal.contentEl.createDiv({text: j.requirements || '岗位要求待补充，可从岗位原文或截图核实。', cls: 'kja-prep-requirements'});
    if (j.responsibilities) { modal.contentEl.createEl('h3', {text: '岗位职责'}); modal.contentEl.createDiv({text: j.responsibilities, cls: 'kja-prep-requirements'}); }
    if (j.notes) { modal.contentEl.createEl('h3', {text: '个人备注'}); modal.contentEl.createDiv({text: j.notes, cls: 'kja-prep-requirements'}); }
    const sources = modal.contentEl.createDiv({cls: 'kja-actions'});
    this.link(sources, '岗位原网页 ↗', j.url);
    for (const [i, ref] of (j.sources || []).entries()) {
      this.link(sources, ref.title || `来源 ${i + 1}`, ref.url);
      if (ref.attachment) this.action(sources, '原始截图', () => p.openNote(ref.attachment), 'kja-quiet');
    }
    modal.open();
  }
  companyDetails(company) {
    const modal = new ob.Modal(this.plugin.app); modal.titleEl.setText(company.name); modal.contentEl.addClass('kja-details');
    const p = this.plugin, actions = modal.contentEl.createDiv({cls: 'kja-actions'});
    if (company.archived) this.action(actions, '还原企业', async () => { await p.setCompanyArchived(company.id, false); modal.close(); }, 'mod-cta');
    else {
      this.action(actions, company.wish ? '取消关注' : '加入心愿单', async () => { await p.toggleWish(company.id); modal.close(); });
      this.action(actions, 'AI 调研', () => p.addDiaryDialog(company, '调研'));
      this.action(actions, '归档企业', async () => { await p.setCompanyArchived(company.id, true); modal.close(); });
    }
    this.action(actions, '编辑企业备注', () => p.editCompanyNotes(company, true, () => modal.close()));
    if (company.wish && !company.archived) this.action(actions, '加岗位', () => { modal.close(); p.newJob(company); });
    if (company.notes) modal.contentEl.createEl('p', {text: company.notes});
    if (company.research) {
      const research = company.research, card = modal.contentEl.createDiv({cls: 'kja-source-card'});
      card.createEl('h4', {text: 'AI 调研与截图资料'});
      if (research.summary) card.createEl('p', {text: research.summary});
      if (research.locations?.length) card.createDiv({text: '工作地点：' + research.locations.join('、')});
      card.createDiv({text: `${(p.data.candidateJobs || []).filter(j => j.companyId === company.id).length} 个具体岗位 · 核实 ${research.checkedAt}`, cls: 'kja-muted'});
      if (research.unknowns?.length) card.createDiv({text: '待核实：' + research.unknowns.join('；'), cls: 'kja-muted'});
      const links = card.createDiv({cls: 'kja-actions'}); this.link(links, '官方投递入口 ↗', research.applicationUrl);
      for (const [i, source] of (research.sources || []).entries()) {
        this.link(links, source.title || `来源 ${i + 1}`, source.url);
        if (source.attachment) this.action(links, '原始截图', () => p.openNote(source.attachment));
      }
      if (company.wish && !company.archived) this.action(links, '勾选调研岗位', () => { modal.close(); p.newJob(company); }, 'mod-cta');
    }
    const records = p.data.records.filter(r => r.companyId === company.id), seen = new Map();
    for (const r of records) {
      const f = r.fields, signature = JSON.stringify([r.sheet, f['招聘计划/岗位'] || f['活动名称'], r.links['投递入口'] || '', f['活动开始时间'] || '']);
      if (!seen.has(signature)) seen.set(signature, []); seen.get(signature).push(r);
    }
    for (const group of seen.values()) {
      const r = group[0], f = r.fields, card = modal.contentEl.createDiv({cls: 'kja-source-card'});
      card.createEl('h4', {text: f['招聘计划/岗位'] || f['活动名称'] || '招聘信息'});
      const facts = r.sheet === '投递信息' ? [['工作地点', f['工作地点']], ['截止时间（原表，待核实）', f['投递截止时间']], ['要求', f['适用要求']], ['岗位摘要', f['岗位摘要']], ['内推码', f['内推码']]]
        : [['活动时间', f['活动开始时间']], ['地点', f['地点']], ['现场面试', f['是否可线下面试']], ['预约状态', f['我的预约状态']], ['活动状态', f['活动状态']]];
      for (const [label, value] of facts) if (value) card.createDiv({text: `${label}：${value}`});
      const links = card.createDiv({cls: 'kja-actions'}); this.link(links, '投递入口', r.links['投递入口']); this.link(links, '预约／报名入口', r.links['预约/报名入口']);
      for (const [i, item] of group.entries()) this.link(links, '原文' + (group.length > 1 ? ` ${i + 1}` : ''), item.links['原文链接']);
      if (r.sheet === '投递信息' && company.wish && !company.archived) this.action(links, '选这个计划，添加岗位', () => { modal.close(); p.newJob(company, r); });
      card.createDiv({text: `${group.length} 条来源 · ${f['时间依据'] || '时间待核实'} · ${f['备注'] || ''}`, cls: 'kja-muted'});
    }
    modal.open();
  }
  renderResumes() {
    this.resultCount.setText('基础简历与岗位版本');
    const card = this.main.createDiv({cls: 'kja-resume-card'}); card.createEl('h3', {text: '基础工作简历'});
    card.createEl('p', {text: '经历与技能的原始文本。岗位版本从这里复制，按目标岗位修改。', cls: 'kja-muted'});
    this.action(card, '打开基础简历', () => this.plugin.openNote(RESUME), 'mod-cta');
    for (const j of this.plugin.data.jobs) {
      const r = this.main.createDiv({cls: 'kja-resume-row'}); r.createDiv({text: `${this.plugin.company(j).name} · ${j.name}`});
      const a = r.createDiv({cls: 'kja-actions'});
      if (j.resume) this.action(a, '打开已关联版本', () => this.plugin.openNote(j.resume));
      this.action(a, '选择已有简历', () => this.plugin.pickResume(j)); this.action(a, '建立岗位版本', () => this.plugin.resumeVersion(j));
      this.action(a, 'AI 匹配', () => this.plugin.addDiaryDialog(j, '匹配'));
    }
  }
  async renderDiary() {
    const request = this.diaryRequest = (this.diaryRequest || 0) + 1, k = null;
    const rel = `工作投递/日记/${day()}.md`, file = this.plugin.app.vault.getAbstractFileByPath(rel);
    const raw = file ? await this.plugin.app.vault.cachedRead(file) : '';
    if (this.dead || request !== this.diaryRequest) return;
    this.diary.empty();
    // Use the same topic-heading boundary as the skeleton.
    const body = raw.split('\n'), start = body.findIndex(l => /^###\s/.test(l) && l.includes(`[[${TOPIC}]]`));
    const lines = []; if (start >= 0) for (let i = start + 1; i < body.length && !/^#{1,3}\s/.test(body[i]); i++) lines.push({line: body[i], number: i});
    const tasks = lines.filter(x => /^\s*- \[[ x]\]\s*\S/.test(x.line) && !/#想要(?:\s|$)/.test(x.line));
    if (!tasks.length) this.diary.createDiv({text: '今天还没有求职任务。可从企业或岗位行添加。', cls: 'kja-muted'});
    for (const item of tasks) {
      const row = this.diary.createDiv({cls: 'kja-task'}), check = row.createEl('input', {type: 'checkbox', attr: {'aria-label': '完成求职任务'}}); check.checked = /- \[x\]/.test(item.line);
      row.createSpan({text: item.line.replace(/^\s*- \[[ x]\]\s*/, '')});
      check.onchange = async () => {
        try { await this.plugin.transact('更新日记任务', async (d, tx) => {
          await this.plugin.flushDiary(rel);
          const text = await this.plugin.app.vault.read(file), ls = text.split('\n');
          if (ls[item.number] !== item.line) throw new Error('任务内容已变，请刷新后重试。');
          ls[item.number] = item.line.replace(/\[[ x]\]/, check.checked ? '[x]' : '[ ]');
          await tx.addFile(rel, ls.join('\n'));
        }); } catch (_) { check.checked = !check.checked; }
      };
    }
    const p = this.plugin;
    this.action(this.diary, '新增行动', () => p.addDiaryDialog({name: '工作投递'}, '跟进'));
    if (tasks.some(x => /#AI\b/i.test(x.line)) && k) this.action(this.diary, '生成 AI 任务单', async () => {
      await p.snapshotRuntime('工作投递/AI结果/AI 任务单.md'); await k.makeTaskSheet();
    });
  }
  renderDeadlines() {
    this.deadlines.empty(); this.deadlines.createEl('h3', {text: '已确认的岗位截止'});
    const dates = P.filtered(this.plugin.data, '岗位').filter(j => j.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline));
    if (!dates.length) this.deadlines.createDiv({text: '暂无。原表截止日期在企业详情中保留，核实后填入目标岗位。', cls: 'kja-muted'});
    for (const j of dates.slice(0, 8)) this.action(this.deadlines, `${j.deadline.slice(0, 10)} · ${j.name}`, () => this.plugin.editJob(j), j.deadline.slice(0, 10) < day() ? 'kja-overdue' : '');
  }
}

module.exports = JobPlugin;
module.exports.P = P;
module.exports.R = R;
module.exports.B = B;
module.exports.CandidatePickerModal = CandidatePickerModal;
module.exports.Dashboard = Dashboard;
