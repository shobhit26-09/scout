import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
export const UA = 'ScoutBot/1.0 (+https://github.com/shobhit26-09/scout)';

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That does not look like a valid URL.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs can be audited.');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Non-standard ports are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error(`Could not resolve ${host}.`); });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error('That address is not publicly reachable.');
  return u;
}

/** Fetch with manual redirects (each hop re-validated), timeout and body cap. */
export async function safeFetch(raw, { method = 'GET', maxRedirects = 5, readBody = true } = {}) {
  const chain = [];
  let url = raw;
  const t0 = performance.now();
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? 'The site took too long to respond (10s).' : `Could not connect: ${e.cause?.code || e.message}`);
    }
    chain.push({ url, status: res.status });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), url).href;
      continue;
    }
    let body = '', bytes = 0, truncated = false;
    if (readBody && method === 'GET') {
      const reader = res.body.getReader();
      const chunks = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_BYTES) { truncated = true; await reader.cancel(); break; }
          chunks.push(value);
        }
      } catch { /* aborted mid-body */ }
      body = Buffer.concat(chunks).toString('utf8');
    } else { await res.body?.cancel().catch(() => {}); }
    clearTimeout(timer);
    return { finalUrl: url, status: res.status, headers: res.headers, body, bytes, truncated, chain, ms: Math.round(performance.now() - t0) };
  }
  throw new Error('Too many redirects.');
}
