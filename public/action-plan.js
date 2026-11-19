const STATUS = new Set(['todo', 'working', 'verify']);
export const planKey = report => `scout.plan.v1:${report.id}`;
export function actionableFindings(report) {
  const source = report.type === 'site' ? report.issues : report.findings;
  const order = { critical: 0, warning: 1, info: 2 };
  return (source || []).filter(item => Object.hasOwn(order, item.severity)).map(item => ({
    id: `${item.category}:${item.id}`,
    title: String(item.title || 'Untitled finding'), category: String(item.category || 'Other'),
    severity: item.severity, fix: String(item.fix || 'Review the evidence and decide whether this applies to your site.'),
    detail: String(item.detail || (item.sample || []).join(', ')),
    pages: Number.isFinite(item.pages) ? item.pages : 1,
  })).sort((a, b) => order[a.severity] - order[b.severity] || b.pages - a.pages);
}
export function readPlan(storage, report) {
  const allowed = new Set(actionableFindings(report).map(item => item.id));
  try {
    const raw = storage.getItem(planKey(report));
    if (raw === null) return { items: {}, error: '' };
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !value.items || typeof value.items !== 'object' || Array.isArray(value.items)) throw new Error();
    const items = {};
    for (const [id, entry] of Object.entries(value.items)) {
      if (!allowed.has(id)) continue;
      if (!entry || !STATUS.has(entry.status) || typeof entry.note !== 'string' || entry.note.length > 1000) throw new Error();
      items[id] = { status: entry.status, note: entry.note };
    }
    return { items, error: '' };
  } catch { return { items: {}, error: 'Saved fix progress could not be loaded. It has not been overwritten. Changing a status or note starts a new saved plan for this report.' }; }
}
export function writePlan(storage, report, items) {
  try { storage.setItem(planKey(report), JSON.stringify({ version: 1, items })); return ''; }
  catch { return 'Fix progress could not be saved on this device. Download the action plan before leaving.'; }
}
export function filterPlan(findings, items, { query = '', severity = 'all', status = 'all', category = 'all' } = {}) {
  const term = query.toLowerCase().trim();
  return findings.filter(item => (severity === 'all' || item.severity === severity) && (status === 'all' || (items[item.id]?.status || 'todo') === status) && (category === 'all' || item.category === category) && (!term || [item.title, item.category, item.fix, item.detail].some(value => value.toLowerCase().includes(term))));
}
const quote = value => String(value).split('\n').map(line => `> ${line}`).join('\n');
export function planMarkdown(report, findings, items) {
  const labels = { todo: 'To do', working: 'In progress', verify: 'Ready to recheck' };
  const lines = ['# Scout action plan', '', `Report: ${report.id}`, `Site: ${report.url}`, `Audit score: ${report.score}/100 | Ruleset: ${report.rulesetVersion || 1}`, "Priorities are Scout's review prompts, not confirmed business impact, a ranking prediction or a security certification.", '', 'Progress is manually recorded on this device, not a verified fix. Run a new audit to check the result. Shared report links do not include this progress or your notes.', ''];
  for (const [i, item] of findings.entries()) {
    const entry = items[item.id] || { status: 'todo', note: '' };
    lines.push(`## ${i + 1}. ${item.severity.toUpperCase()} | ${labels[entry.status]}`, '', quote(item.title), '', `Category: ${item.category} | Affected pages: ${item.pages}`, '', 'Suggested fix:', quote(item.fix), '', 'Audit evidence:', quote(item.detail || 'See the saved report.'), '');
    if (entry.note) lines.push('Your note:', quote(entry.note), '');
  }
  if (!findings.length) lines.push('No actionable findings in this report. Automated checks do not replace a manual review.');
  return lines.join('\n');
}

function comparableUrl(report) {
  try { const url = new URL(report.finalUrl || report.url); url.hash = ''; return url.href; } catch { return null; }
}
export function comparableReports(previous, current) {
  const url = comparableUrl(previous);
  return Boolean((previous.rulesetVersion || 1) === (current.rulesetVersion || 1) && url && url === comparableUrl(current) && (previous.type === 'site') === (current.type === 'site'));
}
export function compareFindings(previous, current) {
  if (!comparableReports(previous, current)) return null;
  const before = new Set(actionableFindings(previous).map(item => item.id));
  const after = new Set(actionableFindings(current).map(item => item.id));
  return { cleared: [...before].filter(id => !after.has(id)).length, introduced: [...after].filter(id => !before.has(id)).length, persisting: [...after].filter(id => before.has(id)).length };
}

export function riskSummary(trust) {
  const label = { safe: 'No flags in checked signals', suspicious: 'Warning signals found', high: 'High-risk signals found' }[trust?.verdict] || 'Check incomplete';
  const checked = trust?.safeBrowsing === 'clean' ? 'Google Safe Browsing returned no listing at audit time.' : trust?.safeBrowsing === 'threat' ? 'Google Safe Browsing returned a threat listing.' : 'Google Safe Browsing was not checked.';
  return { label, detail: `${checked} Automated checks are limited and do not prove a site is safe.` };
}

export const MAX_PLAN_BACKUP_BYTES = 1024 * 1024;
function checkedPlanItems(value, report) {
  const findings = actionableFindings(report), allowed = new Set(findings.map(item => item.id));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 5000) throw new Error('The backup contains invalid fix progress.');
  const items = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!allowed.has(id)) throw new Error('The backup contains a finding that is not part of this report.');
    if (!entry || !STATUS.has(entry.status) || typeof entry.note !== 'string' || entry.note.length > 1000) throw new Error('The backup contains invalid progress or an oversized note.');
    Object.defineProperty(items, id, { value: { status: entry.status, note: entry.note }, enumerable: true });
  }
  return items;
}
export function planBackup(report, items) {
  const raw = JSON.stringify({ format: 'scout-fix-plan', version: 1, report: { id: report.id, url: report.finalUrl || report.url, type: report.type === 'site' ? 'site' : 'page' }, items: checkedPlanItems(items, report) }, null, 2);
  if (new TextEncoder().encode(raw).byteLength > MAX_PLAN_BACKUP_BYTES) throw new Error('This plan is too large for a 1 MB backup. Shorten the notes before exporting.');
  return raw;
}
export function parsePlanBackup(raw, report) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_PLAN_BACKUP_BYTES) throw new Error('Choose a Scout fix-plan backup no larger than 1 MB.');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('This is not a readable JSON fix-plan backup.'); }
  if (!data || data.format !== 'scout-fix-plan' || data.version !== 1 || !data.report || typeof data.report !== 'object') throw new Error('Choose a Scout fix-plan backup (version 1), not a Markdown action plan.');
  if (data.report.id !== report.id || data.report.url !== (report.finalUrl || report.url) || data.report.type !== (report.type === 'site' ? 'site' : 'page')) throw new Error('This backup belongs to another audit. Open the original report to restore it. Progress is never copied onto different audit evidence.');
  return checkedPlanItems(data.items, report);
}
export function restorePlanBackup(storage, report, items, expectedRaw) {
  if (storage.getItem(planKey(report)) !== expectedRaw) throw new Error('Saved progress changed while you reviewed the backup. Choose the backup again after checking the current plan. Nothing was replaced.');
  const safeItems = checkedPlanItems(items, report);
  storage.setItem(planKey(report), JSON.stringify({ version: 1, items: safeItems }));
  return safeItems;
      }
