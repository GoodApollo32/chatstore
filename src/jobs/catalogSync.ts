import type { Db } from '../db/pool.js';
import { normalizeMpn, normalizeUpc } from '../domain/mpn.js';
import { DetailsUnavailableError, type CatalogListing, type DistributorConnector } from '../domain/types.js';
import type { Scope } from '../scope.js';
import { refreshOffers, summarizeErrors } from './priceStock.js';
import { finishRun, saveProgress, startRun, withJobLock, type CallLogger, type JobResult, type Trigger } from './runs.js';

export interface CatalogCounts {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  excluded: Record<string, number>;
  sentToMatchReview: number;
  noLongerListed: number;
  priced: number;
  priceFailed: number;
  detailsFetched: number;
  /** Of those, how many replies had specifications we could read. */
  specsFound?: number;
  /** While running: which step the pull is on, and how many products that step has to get through. */
  stage?: 'catalog' | 'pricing' | 'details';
  stageTotal?: number;
  /** How many steps this pull has (the product-details step is optional). */
  stageCount?: number;
}

interface ResumeState {
  /** When this logical pass started; offers not seen since then are no longer listed. */
  passStartedAt: string;
  manufacturerIndex: number;
  /** Which of the manufacturer's search names (see searchNames) is being walked. */
  termIndex?: number;
  nextPage: number;
}

/**
 * The names to search a manufacturer under: its search name first; only if that finds nothing, each
 * other spelling we know for it (Ingram's manufacturer filter needs Ingram's exact spelling).
 */
function searchNames(m: Scope['manufacturers'][number]): string[] {
  const names = [m.ingramSearch, ...(m.namesUsedByDistributors ?? [])];
  return names.filter((n, i) => names.findIndex((x) => x.trim().toUpperCase() === n.trim().toUpperCase()) === i);
}

export const UNRECOGNIZED_MANUFACTURER = 'Manufacturer name not recognized';
const RESUME_WINDOW_HOURS = 24;
const DETAILS_PROBE = 3;

function emptyCounts(): CatalogCounts {
  return { fetched: 0, created: 0, updated: 0, unchanged: 0, excluded: {}, sentToMatchReview: 0, noLongerListed: 0, priced: 0, priceFailed: 0, detailsFetched: 0 };
}

/** An interrupted or failed pull from the last day is continued where it stopped instead of restarted. */
async function findResumeState(db: Db, distributor: string): Promise<ResumeState | null> {
  const { rows } = await db.query<{ status: string; resume_state: ResumeState | null; started_at: Date }>(
    `SELECT status, resume_state, started_at FROM sync_run
     WHERE distributor = $1 AND job_type = 'catalog' AND status <> 'running'
     ORDER BY started_at DESC LIMIT 1`,
    [distributor],
  );
  const last = rows[0];
  if (!last || !last.resume_state || !['interrupted', 'failed'].includes(last.status)) return null;
  if (Date.now() - last.started_at.getTime() > RESUME_WINDOW_HOURS * 3600_000) return null;
  return last.resume_state;
}

export async function runCatalogSync(deps: {
  db: Db;
  connector: DistributorConnector;
  scope: Scope;
  callLogger: CallLogger;
  trigger: Trigger;
}): Promise<JobResult> {
  const { db, connector, scope, callLogger, trigger } = deps;
  return withJobLock(db, async () => {
    const resumed = await findResumeState(db, connector.id);
    const state: ResumeState = resumed ?? { passStartedAt: new Date().toISOString(), manufacturerIndex: 0, nextPage: 1 };
    const runId = await startRun(db, connector.id, 'catalog', trigger);
    callLogger.runId = runId;
    const counts = emptyCounts();
    const notes: string[] = [];
    if (resumed) notes.push(`Continued an earlier pull that stopped part-way (from ${scope.manufacturers[state.manufacturerIndex]?.name ?? '?'}, page ${state.nextPage}).`);

    try {
      // 1. Walk the catalog for each manufacturer.
      const notFound: string[] = [];
      Object.assign(counts, { stage: 'catalog', stageCount: scope.fetchProductDetails && connector.details ? 3 : 2 });
      for (let m = state.manufacturerIndex; m < scope.manufacturers.length; m++) {
        const manufacturer = scope.manufacturers[m]!;
        const resuming = m === state.manufacturerIndex && (state.nextPage > 1 || (state.termIndex ?? 0) > 0);
        const names = searchNames(manufacturer);
        const foundUnder: { name: string; count: number }[] = [];
        for (let t = m === state.manufacturerIndex ? (state.termIndex ?? 0) : 0; t < names.length; t++) {
          const startPage = m === state.manufacturerIndex && t === (state.termIndex ?? 0) ? state.nextPage : 1;
          let found = 0;
          for await (const page of connector.catalogPages(names[t]!, startPage)) {
            found += page.listings.length;
            for (const listing of page.listings) {
              counts.fetched++;
              await processListing(db, scope, runId, listing, counts);
            }
            Object.assign(state, { manufacturerIndex: m, termIndex: t, nextPage: page.pageNumber + 1 });
            await saveProgress(db, runId, counts, state);
          }
          if (found > 0) foundUnder.push({ name: names[t]!, count: found });
          // Other spellings are only tried when the search name found nothing.
          if (t === 0 && found > 0) break;
          Object.assign(state, { manufacturerIndex: m, termIndex: t + 1, nextPage: 1 });
        }
        if (foundUnder.length && foundUnder[0]!.name !== manufacturer.ingramSearch) {
          notes.push(
            `Ingram found nothing for "${manufacturer.ingramSearch}", so ${manufacturer.name} was searched under its other spellings: ` +
            `${foundUnder.map((f) => `${f.count.toLocaleString('en-CA')} products under "${f.name}"`).join(', ')}.`,
          );
        }
        if (!resuming && foundUnder.length === 0) {
          notFound.push(manufacturer.name);
          const seen = await connector.manufacturerNamesFor?.(manufacturer.ingramSearch).catch(() => [] as string[]) ?? [];
          notes.push(
            `Ingram found no ${manufacturer.name} products under "${manufacturer.ingramSearch}" or any other spelling we know. ` +
            (seen.length
              ? `A general search for "${manufacturer.ingramSearch}" shows Ingram uses these manufacturer names: ${seen.slice(0, 8).map((n) => `"${n}"`).join(', ')}. Add the right one to that manufacturer's names in the scope settings.`
              : 'A general search found nothing either.'),
          );
        }
        Object.assign(state, { manufacturerIndex: m + 1, termIndex: 0, nextPage: 1 });
        await saveProgress(db, runId, counts, state);
      }

      // 2. Products the distributor no longer returns stay in the database but drop out of search.
      // Skipped when a manufacturer search came back empty: that's more likely a search problem than
      // the manufacturer's whole range disappearing, and hiding it all would empty the search page.
      if (notFound.length) {
        notes.push(`Products Ingram may have dropped were not checked this time, because ${notFound.join(', ')} returned nothing.`);
      } else {
        const gone = await db.query(
          `UPDATE distributor_offer SET listed = false, updated_at = now()
           WHERE distributor = $1 AND listed AND (catalog_synced_at IS NULL OR catalog_synced_at < $2)`,
          [connector.id, state.passStartedAt],
        );
        counts.noLongerListed = gone.rowCount ?? 0;
      }

      // 3. Price new products straight away so they don't wait for the next refresh.
      const unpriced = await db.query<{ id: number; sku: string }>(
        `SELECT id, distributor_sku AS sku FROM distributor_offer
         WHERE distributor = $1 AND listed AND price_stock_refreshed_at IS NULL ORDER BY id`,
        [connector.id],
      );
      Object.assign(counts, { stage: 'pricing', stageTotal: unpriced.rows.length });
      await saveProgress(db, runId, counts, state);
      const priced = await refreshOffers(db, connector, unpriced.rows, {
        includeSpecs: true,
        onBatch: async (c) => {
          Object.assign(counts, { priced: c.refreshed, priceFailed: c.failed });
          await saveProgress(db, runId, counts, state);
        },
      });
      counts.priced = priced.counts.refreshed;
      counts.priceFailed = priced.counts.failed;

      // 4. Product details (specs, long description), where the distributor offers them.
      if (scope.fetchProductDetails && connector.details) {
        await fetchDetails(db, connector, counts, notes, () => saveProgress(db, runId, counts, state));
      }

      const status = priced.aborted || counts.priceFailed > 0 || notFound.length ? 'partial' : 'succeeded';
      clearStage(counts);
      await finishRun(db, runId, status, counts, notes, priced.batchErrors.length ? summarizeErrors(priced.batchErrors) : null);
      return { runId, status, summary: describe(counts) };
    } catch (err) {
      // Keep where we got to so the next pull continues from here.
      notes.push('Stopped part-way; the next pull will continue from where this one stopped.');
      clearStage(counts);
      await finishRun(db, runId, 'failed', counts, notes, (err as Error).message, state);
      throw err;
    } finally {
      await callLogger.flush();
    }
  });
}

function clearStage(counts: CatalogCounts): void {
  delete counts.stage;
  delete counts.stageTotal;
  delete counts.stageCount;
}

async function recordExcluded(db: Db, runId: number, l: CatalogListing, reason: string, counts: CatalogCounts): Promise<void> {
  counts.excluded[reason] = (counts.excluded[reason] ?? 0) + 1;
  await db.query(
    `INSERT INTO excluded_listing (run_id, distributor, distributor_sku, manufacturer_raw, title, distributor_category, distributor_subcategory, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [runId, l.distributor, l.distributorSku, l.manufacturerRaw, l.title, l.distributorCategory, l.distributorSubcategory, reason],
  );
}

async function processListing(db: Db, scope: Scope, runId: number, l: CatalogListing, counts: CatalogCounts): Promise<void> {
  const manufacturer = scope.manufacturerFor(l.manufacturerRaw);
  if (!manufacturer) return recordExcluded(db, runId, l, UNRECOGNIZED_MANUFACTURER, counts);
  const classification = scope.classify({
    category: l.distributorCategory, subCategory: l.distributorSubcategory, description: l.title, manufacturer, mpn: l.mpnRaw,
  });
  if (!classification.inScope) {
    // A product we had before that the rules now leave out (e.g. after a scope edit) drops out of search.
    await db.query(
      `UPDATE distributor_offer SET listed = false, excluded_reason = $3, updated_at = now()
       WHERE distributor = $1 AND distributor_sku = $2 AND (listed OR excluded_reason IS DISTINCT FROM $3)`,
      [l.distributor, l.distributorSku, classification.reason],
    );
    return recordExcluded(db, runId, l, classification.reason, counts);
  }

  // Compared inside PostgreSQL: stored JSON comes back with its keys reordered.
  const existing = await db.query<{ id: number; changed: boolean }>(
    `SELECT id, (raw_search IS DISTINCT FROM $3::jsonb OR category <> $4 OR NOT listed) AS changed
     FROM distributor_offer WHERE distributor = $1 AND distributor_sku = $2`,
    [l.distributor, l.distributorSku, JSON.stringify(l.raw), classification.category],
  );
  const values = [
    l.distributor, l.distributorSku, l.manufacturerRaw, l.mpnRaw, l.upc, l.title, l.distributorCategory, l.distributorSubcategory,
    classification.category, l.discontinued, l.authorizedToPurchase, l.directShip, JSON.stringify(l.raw), runId,
  ];
  let offerId: number;
  const before = existing.rows[0];
  if (!before) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO distributor_offer (distributor, distributor_sku, manufacturer_raw, mpn_raw, upc, title, distributor_category,
         distributor_subcategory, category, discontinued, authorized_to_purchase, direct_ship, raw_search, last_seen_run_id, catalog_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now()) RETURNING id`,
      values,
    );
    offerId = rows[0]!.id;
    counts.created++;
  } else {
    offerId = before.id;
    const changed = before.changed;
    await db.query(
      `UPDATE distributor_offer SET manufacturer_raw = $3, mpn_raw = $4, upc = $5, title = $6, distributor_category = $7,
         distributor_subcategory = $8, category = $9, discontinued = $10, authorized_to_purchase = $11, direct_ship = $12,
         raw_search = $13, last_seen_run_id = $14, catalog_synced_at = now(), listed = true, excluded_reason = NULL
         ${changed ? ', updated_at = now()' : ''}
       WHERE distributor = $1 AND distributor_sku = $2`,
      values,
    );
    if (changed) counts.updated++;
    else counts.unchanged++;
  }
  await linkToMasterProduct(db, offerId, manufacturer, l, classification.category, counts);
}

/**
 * Links an offer to its master product by Manufacturer + normalized MPN. Never guesses: a missing
 * MPN or a UPC that contradicts the match sends the offer to match review instead.
 */
async function linkToMasterProduct(
  db: Db, offerId: number, manufacturer: string, l: CatalogListing, category: string, counts: CatalogCounts,
): Promise<void> {
  const mpnKey = normalizeMpn(l.mpnRaw);
  if (!mpnKey) return sendToReview(db, offerId, 'No manufacturer part number', [], counts);

  const found = await db.query<{ id: number; upc: string | null }>(
    `SELECT id, upc FROM master_product WHERE manufacturer = $1 AND mpn_normalized = $2`,
    [manufacturer, mpnKey],
  );
  let masterId: number;
  const match = found.rows[0];
  if (match) {
    const a = normalizeUpc(match.upc);
    const b = normalizeUpc(l.upc);
    if (a && b && a !== b) {
      return sendToReview(db, offerId, 'Same manufacturer part number as an existing product, but a different UPC', [match.id], counts);
    }
    masterId = match.id;
    // While a product has only this one offer, it takes its title and category from it.
    await db.query(
      `UPDATE master_product SET title = $2, category = $3, upc = COALESCE(upc, $4), updated_at = now()
       WHERE id = $1 AND (title <> $2 OR category <> $3 OR (upc IS NULL AND $4::text IS NOT NULL))
         AND NOT EXISTS (SELECT 1 FROM distributor_offer o WHERE o.master_product_id = $1 AND o.id <> $5)`,
      [masterId, l.title, category, l.upc, offerId],
    );
  } else {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO master_product (manufacturer, mpn_raw, mpn_normalized, upc, title, category)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [manufacturer, l.mpnRaw, mpnKey, l.upc, l.title, category],
    );
    masterId = rows[0]!.id;
  }
  await db.query(`UPDATE distributor_offer SET master_product_id = $2 WHERE id = $1`, [offerId, masterId]);
  await db.query(`UPDATE match_review SET status = 'resolved', resolved_at = now() WHERE offer_id = $1 AND status = 'open'`, [offerId]);
}

async function sendToReview(db: Db, offerId: number, reason: string, candidates: number[], counts: CatalogCounts): Promise<void> {
  await db.query(`UPDATE distributor_offer SET master_product_id = NULL WHERE id = $1`, [offerId]);
  const { rowCount } = await db.query(
    `INSERT INTO match_review (offer_id, reason, candidate_product_ids) VALUES ($1,$2,$3)
     ON CONFLICT (offer_id) WHERE status = 'open' DO NOTHING`,
    [offerId, reason, JSON.stringify(candidates)],
  );
  if (rowCount) counts.sentToMatchReview++;
}

async function fetchDetails(
  db: Db, connector: DistributorConnector, counts: CatalogCounts, notes: string[], saveProgressFn: () => Promise<void>,
): Promise<void> {
  const { rows } = await db.query<{ id: number; sku: string }>(
    `SELECT id, distributor_sku AS sku FROM distributor_offer WHERE distributor = $1 AND listed AND details_status IS NULL ORDER BY id`,
    [connector.id],
  );
  Object.assign(counts, { stage: 'details', stageTotal: rows.length });
  await saveProgressFn();
  let unavailableStreak = 0;
  let refurbished = 0;
  for (const offer of rows) {
    try {
      const d = await connector.details!(offer.sku);
      unavailableStreak = 0;
      counts.detailsFetched++;
      if (Object.keys(d.specs).length) counts.specsFound = (counts.specsFound ?? 0) + 1;
      if (d.isRefurbished) refurbished++;
      if (counts.detailsFetched % 10 === 0) await saveProgressFn();
      await db.query(
        `UPDATE distributor_offer SET raw_details = $2, details_status = 'ok', refurbished = $3, updated_at = now() WHERE id = $1`,
        [offer.id, JSON.stringify(d.raw), d.isRefurbished],
      );
      await db.query(
        `UPDATE master_product m SET
           specs = CASE WHEN $2::jsonb <> '{}'::jsonb THEN $2::jsonb ELSE m.specs END,
           image_urls = CASE WHEN jsonb_array_length($3::jsonb) > 0 THEN $3::jsonb ELSE m.image_urls END,
           description = COALESCE($4, m.description), updated_at = now()
         FROM distributor_offer o WHERE o.id = $1 AND m.id = o.master_product_id`,
        [offer.id, JSON.stringify(d.specs), JSON.stringify(d.imageUrls), d.longDescription],
      );
    } catch (err) {
      if (!(err instanceof DetailsUnavailableError)) throw err;
      if (counts.detailsFetched === 0 && ++unavailableStreak >= DETAILS_PROBE) {
        // Left un-tried, so they're attempted again on the next pull in case Ingram turns it on.
        notes.push(`Product details aren't available for this account (Ingram said: ${err.message}). Specs come only from price & availability.`);
        return;
      }
      // While still probing whether details work at all, leave the product to be tried again.
      if (counts.detailsFetched > 0) await db.query(`UPDATE distributor_offer SET details_status = 'failed' WHERE id = $1`, [offer.id]);
    }
  }
  if (refurbished) notes.push(`${refurbished} products turned out to be refurbished and are hidden from search.`);
}

function describe(c: CatalogCounts): string {
  const excluded = Object.values(c.excluded).reduce((a, b) => a + b, 0);
  return `Catalog pull: looked at ${c.fetched} products; ${c.created} new, ${c.updated} changed, ${c.unchanged} unchanged, ` +
    `${excluded} left out, ${c.sentToMatchReview} need a person to check the match, ${c.noLongerListed} no longer listed. ` +
    `Priced ${c.priced} new products (${c.priceFailed} failed).`;
}
