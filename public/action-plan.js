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
  const lines = ['# Scout action plan', '', `Report: ${report.id}`, `Site: ${report.url}`, `Audit score: ${report.score}/100`, '', 'Progress is manually recorded on this device, not a verified fix. Run a new audit to check the result. Shared report links do not include this progress or your notes.', ''];
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
  return Boolean(url && url === comparableUrl(current) && (previous.type === 'site') === (current.type === 'site'));
}
export function compareFindings(previous, current) {
  if (!comparableReports(previous, current)) return null;
  const before = new Set(actionableFindings(previous).map(item => item.id));
  const after = new Set(actionableFindings(current).map(item => item.id));
  return { cleared: [...before].filter(id => !after.has(id)).length, introduced: [...after].filter(id => !before.has(id)).length, persisting: [...after].filter(id => before.has(id)).length };
}
