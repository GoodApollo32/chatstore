import type pg from 'pg';
import type { ApiCallRecord } from '../ingram/client.js';
import type { Db } from '../db/pool.js';
import type { DistributorId } from '../domain/types.js';

export type JobType = 'catalog' | 'price_stock';
export type Trigger = 'manual' | 'schedule' | 'command';
export type RunStatus = 'succeeded' | 'partial' | 'failed' | 'interrupted';

export class JobAlreadyRunningError extends Error {}

/** Writes every distributor call to the call log without holding up the job. */
export class CallLogger {
  runId: number | null = null;
  private pending = new Set<Promise<unknown>>();

  constructor(
    private readonly db: Db,
    private readonly distributor: DistributorId,
  ) {}

  readonly record = (r: ApiCallRecord): void => {
    const p = this.db
      .query(
        `INSERT INTO api_call_log (run_id, distributor, correlation_id, method, path, status, duration_ms, attempt, error,
                                   rate_limit_limit, rate_limit_remaining, rate_limit_reset)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [this.runId, this.distributor, r.correlationId, r.method, r.path, r.status, r.durationMs, r.attempt, r.error,
         r.rateLimit?.limit ?? null, r.rateLimit?.remaining ?? null, r.rateLimit?.resetAt ?? null],
      )
      .catch((err) => console.error('Could not write call log:', err.message))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  };

  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}

const LOCK_KEY = 4_211_337; // one job at a time, across processes

/**
 * Runs `body` while holding the job lock. Only one catalog pull or price & stock refresh runs at
 * a time, whether started from the page, the schedule or the command line.
 */
export async function withJobLock<T>(db: Db, body: () => Promise<T>): Promise<T> {
  const client: pg.PoolClient = await db.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0]?.ok) throw new JobAlreadyRunningError('Another catalog pull or price & stock refresh is already running');
    try {
      return await body();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Runs left "running" by a process that stopped (PC restart, Docker stopped) are marked interrupted. */
export async function markAbandonedRuns(db: Db): Promise<void> {
  await db.query(
    `UPDATE sync_run SET status = 'interrupted', finished_at = now(),
       error_summary = COALESCE(error_summary, 'Stopped before finishing (the program was closed or restarted)')
     WHERE status = 'running'`,
  );
}

export async function startRun(db: Db, distributor: DistributorId, jobType: JobType, trigger: Trigger): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO sync_run (distributor, job_type, trigger) VALUES ($1,$2,$3) RETURNING id`,
    [distributor, jobType, trigger],
  );
  return rows[0]!.id;
}

export async function saveProgress(db: Db, runId: number, counts: unknown, resumeState: unknown): Promise<void> {
  await db.query(`UPDATE sync_run SET counts = $2, resume_state = $3 WHERE id = $1`, [runId, JSON.stringify(counts), JSON.stringify(resumeState)]);
}

export async function finishRun(
  db: Db,
  runId: number,
  status: RunStatus,
  counts: unknown,
  notes: string[],
  errorSummary: string | null,
  resumeState: unknown = null,
): Promise<void> {
  await db.query(
    `UPDATE sync_run SET status = $2, finished_at = now(), counts = $3, notes = $4, error_summary = $5, resume_state = $6 WHERE id = $1`,
    [runId, status, JSON.stringify(counts), JSON.stringify(notes), errorSummary, resumeState === null ? null : JSON.stringify(resumeState)],
  );
}

export interface JobResult {
  runId: number;
  status: RunStatus;
  summary: string;
}
