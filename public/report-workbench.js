import { esc } from './ui.js';
import { actionableFindings, readPlan, writePlan, filterPlan, planMarkdown } from './action-plan.js';

export function mountWorkbench(app, report) {
  const findings = actionableFindings(report);
  const stored = readPlan({ getItem: key => localStorage.getItem(key) }, report);
  let items = stored.items, warning = stored.error, limit = 6;
  const filters = { query: '', severity: 'all', status: 'all', category: 'all' };
  const section = document.createElement('section');
  section.className = 'workbench'; section.setAttribute('aria-labelledby', 'plan-title');
  const anchor = app.querySelector('.toolbar') || app.querySelector('h2.sec2');
  app.insertBefore(section, anchor || null);
  const next = findings.find(item => (items[item.id]?.status || 'todo') !== 'verify');
  section.innerHTML = `<div class="plan-heading"><div><p class="plan-kicker">YOUR FIX WORKBENCH</p><h2 id="plan-title">${findings.length ? 'Turn the audit into a plan.' : 'A clean result. Keep checking.'}</h2><p>Choose a fix, record your progress, then run a fresh audit. Your original score never changes when you tick a box.</p></div><div class="plan-actions"><button type="button" class="btn ghost" id="plan-download">Download action plan</button>${report.type === 'site' ? `<a class="btn" href="/?u=${encodeURIComponent(report.url || report.host)}">Recheck this site</a>` : '<button type="button" class="btn" id="plan-recheck">Recheck this page</button>'}</div></div>
  <div class="plan-progress" id="plan-progress"></div>
  ${next ? `<div class="plan-next"><span>START HERE · ${esc(next.severity.toUpperCase())}</span><h3>${esc(next.title)}</h3><p>${esc(next.fix)}</p><a href="#plan-list">Work through the findings ↓</a></div>` : ''}
  ${report.previous?.changes ? `<div class="plan-comparison"><h3>What changed since the previous audit?</h3><div><b>${report.previous.changes.cleared}</b> not found on this run <b>${report.previous.changes.introduced}</b> newly found <b>${report.previous.changes.persisting}</b> still present</div><p>Compared with the same URL and audit type. A missing finding is not a guarantee that a site is secure or accessible.</p></div>` : ''}
  <p class="plan-storage" id="plan-warning" role="alert"></p>
  <div class="plan-filters"><label>Search findings<input type="search" id="plan-search" placeholder="Title, evidence or fix"></label><label>Severity<select id="plan-severity"><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></label><label>Progress<select id="plan-status"><option value="all">All progress</option><option value="todo">To do</option><option value="working">In progress</option><option value="verify">Ready to recheck</option></select></label><label>Category<select id="plan-category"><option value="all">All categories</option>${[...new Set(findings.map(item => item.category))].map(category => `<option>${esc(category)}</option>`).join('')}</select></label></div>
  <div class="plan-list-heading"><p id="plan-count" aria-live="polite"></p><button type="button" class="plan-reset" id="plan-reset">Reset filters</button></div><div id="plan-list"></div><button type="button" class="btn ghost plan-more" id="plan-more">Show more findings</button>
  <p class="plan-privacy">Progress and notes stay in this browser, for this report only. They are not included when you share the report link. Downloads include your notes, so review them before sharing.</p><p class="plan-recheck-error" id="plan-recheck-error" role="alert"></p>`;
  const get = id => section.querySelector(`#${id}`);
  const entry = item => items[item.id] || { status: 'todo', note: '' };
  function save(item, change) {
    items = { ...items, [item.id]: { ...entry(item), ...change } };
    warning = writePlan({ setItem: (key, value) => localStorage.setItem(key, value) }, report, items);
    showProgress();
  }
  function showProgress() {
    const ready = findings.filter(item => entry(item).status === 'verify').length;
    const working = findings.filter(item => entry(item).status === 'working').length;
    get('plan-progress').innerHTML = `<span><b>${findings.length}</b> actionable findings</span><span><b>${working}</b> in progress</span><span><b>${ready}</b> ready to recheck</span><small>Manually tracked, not verified fixes</small>`;
    const nextItem = findings.find(item => entry(item).status !== 'verify');
    const nextPanel = section.querySelector('.plan-next');
    if (nextPanel) nextPanel.innerHTML = nextItem ? `<span>NEXT IN YOUR PLAN · ${esc(nextItem.severity.toUpperCase())}</span><h3>${esc(nextItem.title)}</h3><p>${esc(nextItem.fix)}</p><a href="#plan-list">Work through the findings ↓</a>` : '<span>READY FOR FRESH EVIDENCE</span><h3>Now run a new audit.</h3><p>All findings are marked ready to recheck. The original findings and score remain unchanged until a fresh audit supplies new evidence.</p>';
    get('plan-warning').textContent = warning;
    get('plan-warning').hidden = !warning;
  }
  function draw() {
    const matches = filterPlan(findings, items, filters);
    get('plan-count').textContent = `${matches.length} of ${findings.length} findings`;
    get('plan-list').innerHTML = matches.slice(0, limit).map(item => {
      const index = findings.indexOf(item), state = entry(item);
      return `<article class="plan-item"><div class="plan-item-top"><span class="plan-number">${index + 1}</span><div><span class="plan-category">${esc(item.category)}${report.type === 'site' ? ` · ${item.pages} pages` : ''}</span><h3>${esc(item.title)}</h3></div><span class="badge b-${item.severity}">${item.severity}</span></div><p class="plan-fix">${esc(item.fix)}</p><div class="plan-item-bottom"><label>Progress<select data-progress="${index}" aria-label="Progress for finding ${index + 1}">${[['todo', 'To do'], ['working', 'In progress'], ['verify', 'Ready to recheck']].map(([value, label]) => `<option value="${value}"${state.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><details><summary>Evidence and your note</summary><pre>${esc(item.detail || 'See the full audit evidence below.')}</pre><label>Your note<textarea maxlength="1000" data-note="${index}" aria-label="Note for finding ${index + 1}" placeholder="What will you change?">${esc(state.note)}</textarea></label><small>Saved on this device. Not shared with the report.</small></details></div></article>`;
    }).join('') || `<div class="plan-empty"><h3>${findings.length ? 'No findings match these filters.' : 'No actionable findings in this audit.'}</h3><p>${findings.length ? 'Reset the filters to see the full plan.' : 'Automated checks cover a limited set of rules. Review your site manually too.'}</p></div>`;
    get('plan-more').hidden = matches.length <= limit;
    section.querySelectorAll('[data-progress]').forEach(input => input.onchange = () => { save(findings[Number(input.dataset.progress)], { status: input.value }); if (filters.status !== 'all') draw(); });
    section.querySelectorAll('[data-note]').forEach(input => input.oninput = () => save(findings[Number(input.dataset.note)], { note: input.value }));
  }
  for (const key of ['search', 'severity', 'status', 'category']) get(`plan-${key}`).addEventListener(key === 'search' ? 'input' : 'change', event => { filters[key === 'search' ? 'query' : key] = event.target.value; limit = 6; draw(); });
  get('plan-reset').onclick = () => { Object.assign(filters, { query: '', severity: 'all', status: 'all', category: 'all' }); for (const key of ['search', 'severity', 'status', 'category']) get(`plan-${key}`).value = key === 'search' ? '' : 'all'; limit = 6; draw(); };
  get('plan-more').onclick = () => { limit += 6; draw(); };
  get('plan-download').onclick = () => { const url = URL.createObjectURL(new Blob([planMarkdown(report, findings, items)], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `scout-action-plan-${String(report.id).replace(/[^a-z0-9-]/gi, '')}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  let running = false;
  async function recheck() {
    if (running) return;
    running = true; get('plan-recheck-error').textContent = '';
    const buttons = [get('plan-recheck'), document.getElementById('again')].filter(Boolean);
    buttons.forEach(button => { button.disabled = true; button.textContent = 'Rechecking…'; });
    try {
      const response = await fetch('/api/crawl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: report.url }), signal: AbortSignal.timeout(120000) });
      const result = await response.json();
      if (!response.ok || !/^[a-f0-9]{10}$/.test(result.id || '')) throw new Error(result.error || 'The audit could not finish. Try again.');
      location.href = `/crawl/${result.id}`;
    } catch (error) { get('plan-recheck-error').textContent = error.name === 'TimeoutError' ? 'The recheck took too long. Your saved report and plan are unchanged. Try again later.' : `Recheck did not complete. ${error.message || 'Check your connection and try again.'}`; }
    finally { running = false; buttons.forEach(button => { button.disabled = false; button.textContent = button.id === 'again' ? 'Run again' : 'Recheck this page'; }); }
  }
  if (get('plan-recheck')) get('plan-recheck').onclick = recheck;
  if (document.getElementById('again')) document.getElementById('again').onclick = recheck;
  const evidence = document.createElement('h2'); evidence.className = 'plan-evidence-title'; evidence.textContent = 'Full audit evidence';
  section.after(evidence);
  showProgress(); draw();
}
