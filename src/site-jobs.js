import { randomBytes } from 'node:crypto';

export const STALE_MS = 120_000;
export const RETAIN_MS = 24 * 60 * 60_000;
const INTERRUPTED = 'This crawl stopped reporting progress. The server may have restarted. Start a new crawl.';

// The crawler is not resumable: retain its last checkpoint and make failure explicit.
// Admission control is per process, just as before. This is not a distributed queue.
export function createSiteJobs({ store, crawlSite, saveCrawl, now = Date.now, heartbeatMs = 5000, staleMs = STALE_MS }) {
  let running = 0;
  const tasks = new Set();
  async function execute(job, url) {
    let writes = Promise.resolve(), storageError;
    const persist = () => {
      const snapshot = { ...job, updatedAt: now() };
      writes = writes.then(async () => {
        if (!await store.updateJob(snapshot)) throw new Error('Crawl tracking expired. Start a new crawl.');
      }).catch((e) => { storageError ||= e; });
      return writes;
    };
    const heartbeat = setInterval(persist, heartbeatMs);
    heartbeat.unref();
    try {
      const report = await crawlSite(url, (progress) => { job.progress = progress; });
      clearInterval(heartbeat);
      await writes;
      if (storageError) throw new Error('Crawl tracking could not be saved. Start a new crawl.');
      job.resultId = await saveCrawl(report);
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = e.message || 'Crawl failed.';
    } finally {
      clearInterval(heartbeat);
      await writes;
      job.finished = now();
      await persist();
      // A storage outage may prevent the final write. On recovery the stale-job
      // check makes this an explicit interruption rather than "running" forever.
      running--;
    }
  }
  return {
    get running() { return running; },
    async start(url) {
      // Reserve synchronously, before the first storage await.
      if (running >= 1) return null;
      running++;
      const started = now();
      const job = { id: randomBytes(16).toString('hex'), status: 'running', progress: { phase: 'Starting' }, started, updatedAt: started };
      try {
        await store.pruneJobs(started - RETAIN_MS);
        await store.createJob(job);
      } catch (e) { running--; throw e; }
      const task = execute(job, url);
      tasks.add(task);
      task.finally(() => tasks.delete(task));
      return job.id;
    },
    async get(id) {
      if (!/^[a-f0-9]{32}$/.test(id)) return null;
      let job = await store.getJob(id);
      if (!job) return null;
      const at = now();
      if (job.finished != null && job.finished < at - RETAIN_MS) return null;
      if (job.status === 'running' && job.updatedAt < at - staleMs) {
        // Conditional update avoids overwriting a heartbeat or completed result.
        await store.failStaleJob(id, at - staleMs, at, INTERRUPTED);
        job = await store.getJob(id);
      }
      return job;
    },
    async idle() { await Promise.all([...tasks]); },
  };
}
