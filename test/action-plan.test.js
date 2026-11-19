import test from 'node:test';
import assert from 'node:assert/strict';
import { actionableFindings, filterPlan, planKey, readPlan, writePlan, planMarkdown, compareFindings, comparableReports, riskSummary } from '../public/action-plan.js';
const report = { id: 'abc123abcd', url: 'https://example.com/page', finalUrl: 'https://example.com/page', score: 62, findings: [
  { id: 'title', category: 'SEO', severity: 'critical', title: 'Missing title', fix: 'Add a title', detail: '<title> is empty' },
  { id: 'https', category: 'Security', severity: 'pass', title: 'HTTPS' },
  { id: 'lang', category: 'Accessibility', severity: 'warning', title: 'No language', fix: 'Set lang' },
  { id: 'jsonld', category: 'SEO', severity: 'info', title: 'No structured data' },
] };
const store = raw => ({ getItem: () => raw });
test('action plan excludes passing checks and keeps severity order', () => {
 const result = actionableFindings(report); assert.equal(result.length, 3); assert.deepEqual(result.map(item => item.severity), ['critical', 'warning', 'info']); assert.equal(result[0].id, 'SEO:title');
});
test('site actions prioritize affected pages inside each severity', () => {
 const result = actionableFindings({ type: 'site', issues: [{ id: 'a', category: 'SEO', severity: 'warning', pages: 1 }, { id: 'b', category: 'SEO', severity: 'warning', pages: 5 }] }); assert.equal(result[0].pages, 5);
});
test('empty saved state is safe and progress is report-specific', () => { assert.deepEqual(readPlan(store(null), report), { items: {}, error: '' }); assert.notEqual(planKey(report), planKey({ id: 'new-report' })); });
test('corrupt storage is preserved and reported, not silently reset', () => { for (const raw of ['{bad', '{}', '{"version":1,"items":[]}']) assert.match(readPlan(store(raw), report).error, /not been overwritten/); });
test('invalid statuses and oversized notes are rejected', () => { for (const entry of [{ status: 'fixed', note: '' }, { status: 'todo', note: 'x'.repeat(1001) }]) assert.ok(readPlan(store(JSON.stringify({ version: 1, items: { 'SEO:title': entry } })), report).error); });
test('unknown findings cannot pollute the saved plan', () => { const saved = readPlan(store(JSON.stringify({ version: 1, items: { 'SEO:title': { status: 'working', note: 'Check wording' }, obsolete: { status: 'fixed' } } })), report); assert.deepEqual(Object.keys(saved.items), ['SEO:title']); assert.equal(saved.items['SEO:title'].note, 'Check wording'); });
test('storage denial is visible to the user', () => { assert.match(readPlan({ getItem() { throw new Error(); } }, report).error, /could not be loaded/); assert.match(writePlan({ setItem() { throw new Error(); } }, report, {}), /could not be saved/); });
test('combined filters include notes only as state, not audit evidence', () => { const rows = actionableFindings(report), items = { 'SEO:title': { status: 'verify', note: '' } }; assert.equal(filterPlan(rows, items, { query: 'title', category: 'SEO', severity: 'critical', status: 'verify' }).length, 1); assert.equal(filterPlan(rows, items, { status: 'todo' }).length, 2); assert.equal(filterPlan(rows, items, { query: 'no matches' }).length, 0); });
test('markdown handoff includes actual evidence, progress and privacy caveat', () => { const output = planMarkdown(report, actionableFindings(report), { 'SEO:title': { status: 'verify', note: 'Deployed to staging' } }); assert.match(output, /Ready to recheck/); assert.match(output, /not a verified fix/); assert.match(output, /> <title> is empty/); assert.match(output, /> Deployed to staging/); assert.doesNotMatch(output, /Security \|/); });
test('fresh audit compares rule identities without calling them verified fixes', () => { const current = { ...report, findings: [report.findings[2], { id: 'new', category: 'SEO', severity: 'info' }] }; assert.deepEqual(compareFindings(report, current), { cleared: 2, introduced: 1, persisting: 1 }); });
test('different pages and audit types never become a misleading comparison', () => { assert.equal(comparableReports(report, { ...report, url: 'https://example.com/other', finalUrl: 'https://example.com/other' }), false); assert.equal(compareFindings(report, { ...report, type: 'site' }), null); assert.equal(comparableReports({ ...report, url: 'bad', finalUrl: 'bad' }, report), false); });
test('fragments are ignored while meaningful queries remain distinct', () => { assert.equal(comparableReports(report, { ...report, finalUrl: `${report.finalUrl}#section` }), true); assert.equal(comparableReports(report, { ...report, finalUrl: `${report.finalUrl}?variant=2` }), false); });

test('risk summary never turns incomplete automated checks into a safety guarantee', () => {
 const missing = riskSummary({ verdict: 'safe', safeBrowsing: 'unavailable' });
 assert.equal(missing.label, 'No flags in checked signals');
 assert.match(missing.detail, /was not checked/);
 assert.match(missing.detail, /do not prove a site is safe/);
 assert.match(riskSummary({ verdict: 'safe', safeBrowsing: 'clean' }).detail, /at audit time/);
 assert.equal(riskSummary({ verdict: 'high', safeBrowsing: 'threat' }).label, 'High-risk signals found');
 assert.equal(riskSummary({ verdict: 'invented' }).label, 'Check incomplete');
});
