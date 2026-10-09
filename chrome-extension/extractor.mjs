// Runs in Chrome's isolated world only after the user opens the extension.
export function extractJob(options = {}) {
  const clean = v => String(v || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const visible = el => !!el && !el.closest?.('[hidden],[aria-hidden="true"]') && (el.getClientRects?.().length || el.tagName === 'META');
  const text = el => clean(el?.innerText || el?.textContent);
  const first = selectors => {
    for (const selector of selectors) for (const el of document.querySelectorAll(selector)) if (visible(el) && text(el)) return text(el);
    return '';
  };
  const plainHtml = value => {
    // Parsing into an inert template does not execute scripts or load assets.
    const template = document.createElement('template'); template.innerHTML = String(value || '');
    for (const el of template.content.querySelectorAll('script,style,iframe,object')) el.remove();
    return clean(template.content.textContent);
  };
  const nodes = [], walk = (value, depth = 0) => {
    if (depth > 16 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.includes('JobPosting')) nodes.push(value);
    if (value['@graph']) walk(value['@graph'], depth + 1);
    if (value.mainEntity) walk(value.mainEntity, depth + 1);
    if (value.itemListElement) for (const item of value.itemListElement) walk(item.item || item, depth + 1);
  };
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 25)) {
    if ((script.textContent || '').length > 500000) continue;
    try { walk(JSON.parse(script.textContent)); } catch (_) {}
  }
  const currentUrl = location.href;
  const matching = nodes.filter(j => { try { return j.url && new URL(j.url, currentUrl).href === currentUrl; } catch (_) { return false; } });
  const job = nodes.length === 1 ? nodes[0] : matching.length === 1 ? matching[0] : null;
  const warnings = [];
  if (nodes.length > 1 && !job) warnings.push('页面包含多个岗位，请确认当前具体岗位；不会整页批量导入。');
  const title = clean(document.title);
  const meta = name => clean(document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content);
  const isGeneric = name => !name || /^[-—–·\s]+$/.test(name) || /^(招聘|校园招聘|社会招聘|人才招聘|职位列表|岗位列表|加入我们|职位详情|岗位详情|job details?|careers?|jobs?)$/i.test(name);
  let name = clean(job?.title);
  if (!name && !nodes.length) {
    name = first(['main h1', 'h1', '[itemprop="title"]', '[data-testid="job-title"]', '.job-title', '.job-name', '.position-title', '.position-name', '[class*="jobTitle"]', '[class*="positionTitle"]']);
    if (isGeneric(name)) name = '';
    if (!name) {
      const part = title.split(/\s*[|｜—–]\s*/)[0];
      if (part.length < 100 && /工程师|经理|专员|助理|分析师|研究员|设计师|顾问|开发|实习|intern|engineer|manager|analyst|designer/i.test(part)) name = part;
    }
  }
  const listNames = [...new Set([...document.querySelectorAll('.job-title,.job-name,.position-title,.position-name,[class*="jobTitle"],[class*="positionTitle"]')].filter(visible).map(text).filter(Boolean))];
  const heading = first(['main h1', 'h1']);
  if (!job && listNames.length > 1 && (!heading || isGeneric(heading))) { name = ''; warnings.push('这是多岗位列表，请进入具体岗位详情，或手动填写当前选择的岗位。'); }
  if (isGeneric(name)) name = '';
  let company = clean(job?.hiringOrganization?.name);
  if (!company) company = first(['[itemprop="hiringOrganization"] [itemprop="name"]', '[data-testid="company-name"]', '.company-name', '.companyName', '[class*="company-name"]', '[class*="companyName"]', '[class*="corpName"]']);
  const known = options.companies || [];
  if (!company) {
    const identity = [title, meta('og:title'), first(['header', '.header', '.company-logo'])].join(' ');
    const matches = known.filter(c => c.labels.some(label => label.length >= 2 && identity.includes(label)));
    if (matches.length === 1) company = matches[0].name;
  }
  if (!company) {
    const siteName = meta('og:site_name');
    if (siteName && siteName.length < 80 && !/飞书|feishu|moka|mokahr|智联|前程无忧|猎聘|boss|招聘平台/i.test(siteName)) company = siteName.replace(/\s*(校园招聘|招聘官网|招聘网站|招聘系统|人才招聘|Careers)\s*$/i, '').trim();
  }
  const readLocations = posting => {
    const entries = Array.isArray(posting?.jobLocation) ? posting.jobLocation : posting?.jobLocation ? [posting.jobLocation] : [];
    return [...new Set(entries.map(x => {
      const address = x.address || {};
      return clean([address.addressLocality, address.addressRegion].filter(Boolean).join(' ') || x.name || (typeof address === 'string' ? address : ''));
    }).filter(Boolean))].join('、');
  };
  let locationText = readLocations(job) || first(['[itemprop="jobLocation"]', '[data-testid="job-location"]', '.job-location', '.position-location', '[class*="jobLocation"]']);
  const root = document.querySelector('main,article,[role="main"],.job-detail,.position-detail') || document.body;
  const body = text(root).split(/\n\s*(?:RESUME PRO|填表助手)\s*(?:\n|$)/i)[0].slice(0, 40000);
  if (!locationText && name) {
    const header = text(document.body).split(/\n\s*(?:RESUME PRO|填表助手)\s*(?:\n|$)/i)[0].slice(0, 6000);
    const titleIndex = header.indexOf(name);
    const city = '(?:北京|上海|天津|重庆|深圳|广州|南京|杭州|苏州|无锡|合肥|武汉|成都|西安|长沙|郑州|济南|青岛|宁波|厦门|福州|南昌|沈阳|大连|长春|哈尔滨|石家庄|太原|南宁|昆明|贵阳|海口|东莞|佛山|惠州|珠海|常州|嘉兴|湖州|绍兴|扬州|南通|镇江|徐州|全国|远程)(?:市)?';
    if (titleIndex >= 0) locationText = new RegExp('^' + city + '(?:\\s*[、,，/]\\s*' + city + ')*(?=\\s|校招|正式|实习|全职|$)').exec(header.slice(titleIndex + name.length, titleIndex + name.length + 200).trim())?.[0] || '';
  }
  const section = labels => {
    const lines = body.split('\n').map(clean).filter(Boolean);
    const start = lines.findIndex(line => labels.some(label => new RegExp('^' + label + '[：:]?$').test(line)));
    if (start < 0) return '';
    let end = start + 1;
    while (end < lines.length && end < start + 70 && !/^(岗位职责|工作职责|职位描述|岗位要求|任职要求|任职资格|职位要求|福利待遇|投递方式|投递|申请职位|立即申请|立即投递|职位推荐|相关职位|Responsibilities|Qualifications|Requirements)[：:]?$/i.test(lines[end])) end++;
    return lines.slice(start + 1, end).filter(line => !/^[-—–·\s]+$/.test(line)).join('\n').slice(0, 10000);
  };
  const responsibilities = plainHtml(job?.responsibilities) || section(['岗位职责', '工作职责', '职位描述', 'Responsibilities']);
  const requirements = [job?.qualifications, job?.educationRequirements, job?.experienceRequirements, job?.skills].map(v => typeof v === 'string' ? plainHtml(v) : '').filter(Boolean).join('\n') || section(['岗位要求', '任职要求', '任职资格', '职位要求', 'Qualifications', 'Requirements']);
  if (!locationText) locationText = clean(/(?:工作地点|工作城市|工作地区|招聘地点|职位地点)\s*[：:]\s*([^\n]{1,100})/.exec(body)?.[1]);
  const batchMatch = /(?:20\d{2}\s*届[^\n，。]{0,22}(?:校招|校园招聘)|20\d{2}\s*届(?:校招|校园招聘)|20\d{2}(?:届)?(?:春季|秋季)?(?:校招|校园招聘))/.exec([title, body.slice(0, 6000)].join('\n'));
  if (!company) warnings.push('企业未自动识别，请填写或从已有企业中选择。');
  if (!name) warnings.push('未定位具体岗位名称，请填写后保存。');
  if (!requirements) warnings.push('岗位要求未自动提取，可展开补充。');
  return {company: {name: company.slice(0, 180)}, name: name.slice(0, 240), batch: clean(batchMatch?.[0]).slice(0, 160),
    location: locationText.slice(0, 400), url: currentUrl, requirements: requirements.slice(0, 12000), responsibilities: responsibilities.slice(0, 12000),
    title: title.slice(0, 400), evidence: [company, name, locationText, requirements.slice(0, 900)].filter(Boolean).join('\n').slice(0, 1600),
    warnings, method: job ? '网页结构化岗位信息' : '页面标题与可见文本'};
}
