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
export const nav = `<nav class="top wrap"><a class="brand" href="/">${logo}Scout</a><div class="links"><a href="/#how">How it works</a><a href="/#recent">Recent audits</a><a class="keep" href="https://github.com/shobhit26-09/scout">GitHub</a></div></nav>`;
export const foot = `<footer><div class="wrap"><span>Scout audits one page at a time and respects robots.txt.</span><span>Rule-based checks. No tracking, no sign-up.</span></div></footer>`;
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.append(t); }
  t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1800);
}
