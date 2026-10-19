import type { ScheduleConfig } from '../config.js';
import type { JobKind, JobRunner } from './runner.js';

// The automatic schedule. Off by default for the prototype; Chris refreshes by hand from the page.

function localTime(date: Date, timezone: string): { day: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${get('hour')}:${get('minute')}` };
}

/** Which jobs are due at `now`, given what already ran. Exported for tests. */
export function dueJobs(
  now: Date,
  config: ScheduleConfig,
  lastFired: Map<string, string>,
  lastIntervalRun: number | null,
): { jobs: JobKind[]; firedKeys: string[]; intervalFired: boolean } {
  const { day, hhmm } = localTime(now, config.timezone);
  const jobs: JobKind[] = [];
  const firedKeys: string[] = [];
  const check = (kind: JobKind, times: string[]) => {
    for (const t of times) {
      const key = `${kind}@${t}`;
      if (t === hhmm && lastFired.get(key) !== day) {
        jobs.push(kind);
        firedKeys.push(key);
      }
    }
  };
  check('catalog', config.catalogTimes);
  check('price_stock', config.refreshTimes);
  let intervalFired = false;
  if (config.refreshEveryMinutes && (lastIntervalRun === null || now.getTime() - lastIntervalRun >= config.refreshEveryMinutes * 60_000)) {
    if (!jobs.includes('price_stock')) jobs.push('price_stock');
    intervalFired = true;
  }
  return { jobs: [...new Set(jobs)], firedKeys, intervalFired };
}

export function startScheduler(config: ScheduleConfig, runner: JobRunner): () => void {
  if (!config.enabled) return () => {};
  const lastFired = new Map<string, string>();
  let lastIntervalRun: number | null = null;
  const tick = async () => {
    const now = new Date();
    const { jobs, firedKeys, intervalFired } = dueJobs(now, config, lastFired, lastIntervalRun);
    const day = localTime(now, config.timezone).day;
    for (const key of firedKeys) lastFired.set(key, day);
    if (intervalFired) lastIntervalRun = now.getTime();
    // Catalog first: it also prices new products.
    for (const kind of jobs.sort((a, b) => Number(a !== 'catalog') - Number(b !== 'catalog'))) {
      if (runner.current) {
        console.log(`Schedule: skipped ${kind}, another update is running`);
        continue;
      }
      try {
        const result = await runner.run(kind, 'schedule');
        console.log(`Schedule: ${result.summary}`);
      } catch (err) {
        console.error(`Schedule: ${kind} failed: ${(err as Error).message}`);
      }
    }
  };
  const timer = setInterval(() => void tick(), 20_000);
  console.log(
    `Automatic schedule ON (${config.timezone}): catalog at ${config.catalogTimes.join(', ')}; price & stock at ${config.refreshTimes.join(', ')}` +
      (config.refreshEveryMinutes ? `, plus every ${config.refreshEveryMinutes} minutes` : ''),
  );
  return () => clearInterval(timer);
}
