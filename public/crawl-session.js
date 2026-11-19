export const CRAWL_SESSION_KEY = 'scout.pending-crawl.v1';
export const CRAWL_SESSION_TTL = 24 * 60 * 60 * 1000;
const valid = value => value && /^[a-f0-9]{32}$/.test(value.job) && typeof value.url === 'string' && value.url.length <= 2000 && Number.isFinite(value.createdAt);
export function rememberCrawl(storage, job, url, now = Date.now()) {
  const value = { job, url, createdAt: now };
  if (!valid(value)) return false;
  try { storage.setItem(CRAWL_SESSION_KEY, JSON.stringify(value)); return true; } catch { return false; }
}
export function forgetCrawl(storage) {
  try { storage.removeItem(CRAWL_SESSION_KEY); } catch { /* Storage may be disabled. */ }
}
export function pendingCrawl(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(CRAWL_SESSION_KEY));
    if (valid(value) && value.createdAt <= now && now - value.createdAt < CRAWL_SESSION_TTL) return value;
    forgetCrawl(storage);
  } catch { /* Corrupt or blocked session storage must not break the form. */ }
  return null;
}
export async function pollCrawl(job, { fetchStatus, onProgress = () => {}, wait = () => new Promise(resolve => setTimeout(resolve, 1500)), onTerminal = () => {} }) {
  if (!/^[a-f0-9]{32}$/.test(job)) throw new Error('That crawl ID is invalid.');
  for (;;) {
    const response = await fetchStatus(job);
    const state = await response.json();
    if (!response.ok) {
      if (response.status === 404) onTerminal();
      throw new Error(state.error || 'Crawl status is temporarily unavailable. Check the saved crawl again.');
    }
    if (state.status === 'error') { onTerminal(); throw new Error(state.error || 'The crawl stopped before completion.'); }
    if (state.status === 'done') {
      if (!/^[a-f0-9]{10}$/.test(state.id)) throw new Error('The crawl returned an invalid report ID.');
      onTerminal(); return state.id;
    }
    if (state.status !== 'running') throw new Error('Crawl status is not recognized. Check again later.');
    onProgress(state.progress || {});
    await wait();
  }
}
