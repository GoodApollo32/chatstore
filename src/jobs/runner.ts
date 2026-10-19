import { loadIngramConfig } from '../config.js';
import type { Db } from '../db/pool.js';
import { IngramConnector } from '../ingram/connector.js';
import { loadScope } from '../scope.js';
import { runCatalogSync } from './catalogSync.js';
import { runPriceStockRefresh } from './priceStock.js';
import { CallLogger, JobAlreadyRunningError, type JobResult, type Trigger } from './runs.js';

export type JobKind = 'catalog' | 'price_stock';

/** Starts jobs for the page, the schedule and the command line, with fresh settings each time. */
export class JobRunner {
  current: JobKind | null = null;
  lastError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly scopeFile: string,
  ) {}

  async run(kind: JobKind, trigger: Trigger): Promise<JobResult> {
    if (this.current) throw new JobAlreadyRunningError('Another catalog pull or price & stock refresh is already running');
    this.current = kind;
    this.lastError = null;
    try {
      // Re-read the scope each run so edits apply without restarting.
      const scope = loadScope(this.scopeFile);
      const callLogger = new CallLogger(this.db, 'ingram');
      const connector = new IngramConnector(loadIngramConfig(), scope.warehouseCountries, { onCall: callLogger.record });
      return kind === 'catalog'
        ? await runCatalogSync({ db: this.db, connector, scope, callLogger, trigger })
        : await runPriceStockRefresh({ db: this.db, connector, callLogger, trigger });
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    } finally {
      this.current = null;
    }
  }

  /** Fire-and-forget start for the page; the outcome shows up in the run history. */
  startInBackground(kind: JobKind, trigger: Trigger): { started: boolean; reason?: string } {
    if (this.current) return { started: false, reason: 'Another update is already running.' };
    this.run(kind, trigger).catch((err) => console.error(`${kind} run failed:`, err.message));
    return { started: true };
  }
}
