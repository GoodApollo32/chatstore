import { describe, expect, it } from 'vitest';
import type { ScheduleConfig } from '../src/config.js';
import { dueJobs } from '../src/jobs/scheduler.js';

const config: ScheduleConfig = { enabled: true, timezone: 'America/Vancouver', catalogTimes: ['02:00'], refreshTimes: ['06:00', '13:00'], refreshEveryMinutes: undefined };

describe('schedule', () => {
  it('runs the catalog pull at 2 am Pacific, once', () => {
    const at = new Date('2026-10-20T09:00:30Z'); // 02:00 PDT
    const fired = new Map<string, string>();
    const first = dueJobs(at, config, fired, null);
    expect(first.jobs).toEqual(['catalog']);
    for (const k of first.firedKeys) fired.set(k, '2026-10-20');
    expect(dueJobs(new Date('2026-10-20T09:00:50Z'), config, fired, null).jobs).toEqual([]);
  });

  it('runs price & stock at 6 am and 1 pm Pacific', () => {
    expect(dueJobs(new Date('2026-10-20T13:00:10Z'), config, new Map(), null).jobs).toEqual(['price_stock']);
    expect(dueJobs(new Date('2026-10-20T20:00:10Z'), config, new Map(), null).jobs).toEqual(['price_stock']);
    expect(dueJobs(new Date('2026-10-20T15:00:10Z'), config, new Map(), null).jobs).toEqual([]);
  });

  it('supports a short repeating interval for testing', () => {
    const c = { ...config, refreshEveryMinutes: 10 };
    const t0 = new Date('2026-10-20T15:00:00Z');
    expect(dueJobs(t0, c, new Map(), null)).toMatchObject({ jobs: ['price_stock'], intervalFired: true });
    expect(dueJobs(new Date(t0.getTime() + 5 * 60_000), c, new Map(), t0.getTime()).jobs).toEqual([]);
    expect(dueJobs(new Date(t0.getTime() + 10 * 60_000), c, new Map(), t0.getTime()).jobs).toEqual(['price_stock']);
  });
});
