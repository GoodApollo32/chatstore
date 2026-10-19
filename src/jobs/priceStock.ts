import type { Db } from '../db/pool.js';
import type { DistributorConnector, PriceStock } from '../domain/types.js';
import { finishRun, saveProgress, startRun, withJobLock, type CallLogger, type JobResult, type Trigger } from './runs.js';

export interface PriceStockCounts {
  requested: number;
  refreshed: number;
  failed: number;
  costChanged: number;
  inStockCanada: number;
}

const MAX_CONSECUTIVE_BATCH_FAILURES = 3;

/** Saves one price & stock result. Failures keep the last good price (it will show as stale). */
export async function savePriceStock(db: Db, offerId: number, r: PriceStock): Promise<{ costChanged: boolean; inStockCanada: boolean }> {
  if (!r.ok) {
    await db.query(`UPDATE distributor_offer SET price_stock_error = $2, raw_price_stock = $3, updated_at = now() WHERE id = $1`, [
      offerId, r.error, JSON.stringify(r.raw),
    ]);
    return { costChanged: false, inStockCanada: false };
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query<{ cost: number | null }>('SELECT cost FROM distributor_offer WHERE id = $1', [offerId]);
    await client.query(
      `UPDATE distributor_offer SET cost = $2, msrp = $3, map_price = $4, currency = $5, ehf = $6, fees = $7,
         quantity_breaks = $8, special_pricing = $9, raw_price_stock = $10, price_stock_error = NULL,
         price_stock_refreshed_at = now(), updated_at = now()
       WHERE id = $1`,
      [offerId, r.cost, r.msrp, r.mapPrice, r.currency, r.ehf, JSON.stringify(r.fees), JSON.stringify(r.quantityBreaks),
        JSON.stringify(r.specialPricing), JSON.stringify(r.raw)],
    );
    await client.query('DELETE FROM offer_stock WHERE offer_id = $1', [offerId]);
    for (const w of r.stock) {
      await client.query(
        `INSERT INTO offer_stock (offer_id, warehouse_id, location, country, quantity_available, quantity_backordered,
           quantity_on_order, backorder_etas, refreshed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
        [offerId, w.warehouseId, w.location, w.country, w.quantityAvailable, w.quantityBackordered, w.quantityOnOrder, JSON.stringify(w.backorderEtas)],
      );
    }
    if (Object.keys(r.specs).length > 0) {
      await client.query(
        `UPDATE master_product m SET specs = $2, updated_at = now()
         FROM distributor_offer o WHERE o.id = $1 AND m.id = o.master_product_id AND m.specs = '{}'::jsonb`,
        [offerId, JSON.stringify(r.specs)],
      );
    }
    await client.query('COMMIT');
    const oldCost = before.rows[0]?.cost ?? null;
    return {
      costChanged: oldCost !== null && oldCost !== r.cost,
      inStockCanada: r.stock.some((w) => w.country === 'CA' && w.quantityAvailable > 0),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetches price & stock for the given offers in batches. Shared by the scheduled refresh and by the
 * catalog pull (which prices newly found products straight away).
 */
export async function refreshOffers(
  db: Db,
  connector: DistributorConnector,
  offers: { id: number; sku: string }[],
  opts: { includeSpecs?: boolean; onBatch?: (counts: PriceStockCounts) => Promise<void> } = {},
): Promise<{ counts: PriceStockCounts; batchErrors: string[]; aborted: boolean }> {
  const counts: PriceStockCounts = { requested: offers.length, refreshed: 0, failed: 0, costChanged: 0, inStockCanada: 0 };
  const batchErrors: string[] = [];
  let consecutiveFailures = 0;
  for (let i = 0; i < offers.length; i += connector.priceStockBatchSize) {
    const batch = offers.slice(i, i + connector.priceStockBatchSize);
    const bySku = new Map(batch.map((o) => [o.sku.toUpperCase(), o.id]));
    let results: PriceStock[];
    try {
      results = await connector.priceAndStock(batch.map((o) => o.sku), { includeSpecs: opts.includeSpecs });
      consecutiveFailures = 0;
    } catch (err) {
      counts.failed += batch.length;
      batchErrors.push((err as Error).message);
      if (++consecutiveFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) return { counts, batchErrors, aborted: true };
      continue;
    }
    for (const r of results) {
      const offerId = bySku.get(r.distributorSku.toUpperCase());
      if (offerId === undefined) continue;
      bySku.delete(r.distributorSku.toUpperCase());
      const saved = await savePriceStock(db, offerId, r);
      if (r.ok) counts.refreshed++;
      else counts.failed++;
      if (saved.costChanged) counts.costChanged++;
      if (saved.inStockCanada) counts.inStockCanada++;
    }
    await opts.onBatch?.(counts);
  }
  return { counts, batchErrors, aborted: false };
}

export async function runPriceStockRefresh(deps: {
  db: Db;
  connector: DistributorConnector;
  callLogger: CallLogger;
  trigger: Trigger;
}): Promise<JobResult> {
  const { db, connector, callLogger, trigger } = deps;
  return withJobLock(db, async () => {
    const runId = await startRun(db, connector.id, 'price_stock', trigger);
    callLogger.runId = runId;
    try {
      const { rows } = await db.query<{ id: number; sku: string }>(
        `SELECT id, distributor_sku AS sku FROM distributor_offer WHERE distributor = $1 AND listed ORDER BY id`,
        [connector.id],
      );
      const { counts, batchErrors, aborted } = await refreshOffers(db, connector, rows, {
        onBatch: (c) => saveProgress(db, runId, c, null),
      });
      const status = aborted ? 'failed' : counts.failed > 0 ? 'partial' : 'succeeded';
      const notes = rows.length === 0 ? ['No products in the catalog yet; run a full catalog pull first.'] : [];
      const errorSummary = batchErrors.length ? summarizeErrors(batchErrors) : null;
      await finishRun(db, runId, status, counts, notes, errorSummary);
      return {
        runId, status,
        summary: `Price & stock refresh: ${counts.refreshed} of ${counts.requested} products updated, ${counts.failed} failed, ` +
          `${counts.costChanged} cost changes, ${counts.inStockCanada} in stock in Canada.`,
      };
    } catch (err) {
      await finishRun(db, runId, 'failed', {}, [], (err as Error).message);
      throw err;
    } finally {
      await callLogger.flush();
    }
  });
}

export function summarizeErrors(errors: string[]): string {
  const unique = [...new Set(errors)];
  return unique.slice(0, 5).join(' | ') + (unique.length > 5 ? ` (+${unique.length - 5} more)` : '');
}
