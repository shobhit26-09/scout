export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const tone = (n) => (n >= 85 ? 'good' : n >= 60 ? 'mid' : 'bad');
export const color = (n) => ({ good: '#12935b', mid: '#c77700', bad: '#e5383b' }[tone(n)]);
export function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
export function ring(n, cls = '') {
  const r = 52, c = 2 * Math.PI * r;
  return `<div class="ring ${cls}"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="#eef0f3" stroke-width="10"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="${color(n)}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - n / 100)}" style="transition:stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)"/></svg><div class="n"><div>${n}<small>out of 100</small></div></div></div>`;
}
export const logo = `<svg viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="9" fill="#0b0d12"/><circle cx="15" cy="15" r="6" stroke="#fff" stroke-width="2.4"/><path d="M19.6 19.6 25 25" stroke="#0a64ff" stroke-width="3" stroke-linecap="round"/></svg>`;
const gh = 'https://github.com/shobhit26-09/scout';
export const nav = `<nav class="top wrap" id="topnav"><a class="brand" href="/">${logo}Scout</a><div class="links"><a href="/#checks">What it checks</a><a href="/how-it-works">How it works</a><a href="/#sample">Sample report</a><a href="/#recent">Recent audits</a><a class="gh" href="${gh}" rel="noopener"><svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.96 0-.88.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.08-1.87 3.76-3.66 3.96.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg>GitHub</a></div><button class="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="topnav"><span></span><span></span></button></nav>`;
export const foot = `<footer><div class="wrap"><div class="fgrid"><div class="fbrand"><a class="brand" href="/">${logo}Scout</a><p>Free website audits that say what is wrong and how to fix it. No sign-up, no tracking.</p></div><div><h4>Product</h4><a href="/#checks">What it checks</a><a href="/how-it-works">How it works</a><a href="/#sample">Sample report</a><a href="/#recent">Recent audits</a></div><div><h4>Project</h4><a href="${gh}" rel="noopener">Source on GitHub</a><a href="${gh}/issues" rel="noopener">Report an issue</a><a href="/#faq">FAQ</a></div></div><div class="fbase"><span>Built by <a href="https://github.com/shobhit26-09" rel="noopener">Shobhit Gupta</a>.</span><span>Scout reads one page at a time and respects robots.txt.</span></div></div></footer>`;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-btn');
    const n = document.getElementById('topnav');
    if (b && n) { const o = n.classList.toggle('open'); b.setAttribute('aria-expanded', o); b.setAttribute('aria-label', o ? 'Close menu' : 'Open menu'); return; }
    if (n && n.classList.contains('open') && (e.target.closest('.links a') || !e.target.closest('#topnav'))) { n.classList.remove('open'); const m = n.querySelector('.menu-btn'); m.setAttribute('aria-expanded', 'false'); m.setAttribute('aria-label', 'Open menu'); }
  });
}
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.append(t); }
  t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1800);
}
