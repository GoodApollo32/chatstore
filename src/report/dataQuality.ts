import type { Db } from '../db/pool.js';

// The plain-language data-quality report for Chris. Computed fresh from the database each time.

export const STALE_HOURS = 48;

export interface DataQualityReport {
  generatedAt: Date;
  totals: { products: number; offers: number; shown: number };
  byManufacturerCategory: { manufacturer: string; category: string; count: number }[];
  hidden: { discontinued: number; notAuthorized: number; refurbished: number; noLongerListed: number };
  completeness: { field: string; have: number; of: number }[];
  /** Shown products for which Ingram's product-details call answered (specs may still be missing). */
  detailsFetched: number;
  pricing: {
    priced: number; neverPriced: number; withPriceError: number; stale: number;
    currencies: { currency: string; count: number }[];
    withMsrp: number; withEhf: number; withQuantityBreaks: number; withSpecialPricing: number;
    otherFees: { description: string; count: number }[];
    topErrors: { error: string; count: number }[];
  };
  stock: {
    inStockCanada: number; onlyInUs: number; noStockAnywhere: number;
    warehouses: { warehouseId: string; location: string | null; country: string | null; products: number; withStock: number }[];
  };
  latestCatalogRun: { id: number; startedAt: Date; status: string; notes: string[] } | null;
  excludedByReason: { reason: string; count: number }[];
  unrecognizedManufacturers: { name: string; count: number }[];
  categoryTranslation: { distributorCategory: string; distributorSubcategory: string; outcome: string; count: number }[];
  matchReview: { reason: string; count: number }[];
  recentRuns: { id: number; jobType: string; trigger: string; startedAt: Date; finishedAt: Date | null; status: string; counts: any; errorSummary: string | null }[];
}

async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query(sql, params)).rows[0] as T;
}

async function many<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

/** Offers that appear in search by default. */
export const SHOWN = `o.listed AND NOT o.discontinued AND o.authorized_to_purchase AND NOT o.refurbished`;

export async function buildReport(db: Db): Promise<DataQualityReport> {
  const totals = await one<{ products: number; offers: number; shown: number }>(db, `
    SELECT (SELECT count(*) FROM master_product)::int AS products,
           count(*) FILTER (WHERE o.listed)::int AS offers,
           count(*) FILTER (WHERE ${SHOWN})::int AS shown
    FROM distributor_offer o`);

  const byManufacturerCategory = await many<{ manufacturer: string; category: string; count: number }>(db, `
    SELECT COALESCE(m.manufacturer, '(needs match review)') AS manufacturer, o.category, count(*)::int AS count
    FROM distributor_offer o LEFT JOIN master_product m ON m.id = o.master_product_id
    WHERE ${SHOWN} GROUP BY 1, 2 ORDER BY 1, 2`);

  const hidden = await one<DataQualityReport['hidden']>(db, `
    SELECT count(*) FILTER (WHERE listed AND discontinued)::int AS "discontinued",
           count(*) FILTER (WHERE listed AND NOT authorized_to_purchase)::int AS "notAuthorized",
           count(*) FILTER (WHERE listed AND refurbished)::int AS "refurbished",
           count(*) FILTER (WHERE NOT listed)::int AS "noLongerListed"
    FROM distributor_offer`);

  const c = await one<Record<string, number>>(db, `
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE o.mpn_raw IS NOT NULL)::int AS mpn,
           count(*) FILTER (WHERE o.upc IS NOT NULL)::int AS upc,
           count(*) FILTER (WHERE m.specs <> '{}'::jsonb)::int AS specs,
           count(*) FILTER (WHERE jsonb_array_length(m.image_urls) > 0)::int AS images,
           count(*) FILTER (WHERE m.description IS NOT NULL)::int AS description,
           count(*) FILTER (WHERE o.details_status = 'ok')::int AS details
    FROM distributor_offer o LEFT JOIN master_product m ON m.id = o.master_product_id
    WHERE ${SHOWN}`);
  const completeness = [
    { field: 'Manufacturer part number', have: c.mpn!, of: c.total! },
    { field: 'UPC barcode', have: c.upc!, of: c.total! },
    { field: 'Specifications', have: c.specs!, of: c.total! },
    { field: 'Images', have: c.images!, of: c.total! },
    { field: 'Long description', have: c.description!, of: c.total! },
  ];

  const p = await one<Record<string, number>>(db, `
    SELECT count(*) FILTER (WHERE price_stock_refreshed_at IS NOT NULL)::int AS priced,
           count(*) FILTER (WHERE price_stock_refreshed_at IS NULL)::int AS "neverPriced",
           count(*) FILTER (WHERE price_stock_error IS NOT NULL)::int AS "withPriceError",
           count(*) FILTER (WHERE price_stock_refreshed_at < now() - interval '${STALE_HOURS} hours')::int AS stale,
           count(*) FILTER (WHERE msrp IS NOT NULL AND msrp > 0)::int AS "withMsrp",
           count(*) FILTER (WHERE ehf IS NOT NULL)::int AS "withEhf",
           count(*) FILTER (WHERE jsonb_array_length(quantity_breaks) > 0)::int AS "withQuantityBreaks",
           count(*) FILTER (WHERE jsonb_array_length(special_pricing) > 0)::int AS "withSpecialPricing"
    FROM distributor_offer o WHERE ${SHOWN}`);
  const currencies = await many<{ currency: string; count: number }>(db, `
    SELECT COALESCE(currency, '(none)') AS currency, count(*)::int AS count FROM distributor_offer o
    WHERE ${SHOWN} AND price_stock_refreshed_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
  const otherFees = await many<{ description: string; count: number }>(db, `
    SELECT COALESCE(f->>'description', f->>'code', '(no description)') AS description, count(*)::int AS count
    FROM distributor_offer o, jsonb_array_elements(o.fees) f
    WHERE ${SHOWN} AND NOT (f->>'isEhf')::boolean GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
  const topErrors = await many<{ error: string; count: number }>(db, `
    SELECT price_stock_error AS error, count(*)::int AS count FROM distributor_offer o
    WHERE ${SHOWN} AND price_stock_error IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);

  const s = await one<Record<string, number>>(db, `
    WITH per_offer AS (
      SELECT o.id,
             COALESCE(sum(s.quantity_available) FILTER (WHERE s.country = 'CA'), 0) AS ca,
             COALESCE(sum(s.quantity_available) FILTER (WHERE s.country = 'US'), 0) AS us
      FROM distributor_offer o LEFT JOIN offer_stock s ON s.offer_id = o.id
      WHERE ${SHOWN} AND o.price_stock_refreshed_at IS NOT NULL GROUP BY o.id)
    SELECT count(*) FILTER (WHERE ca > 0)::int AS "inStockCanada",
           count(*) FILTER (WHERE ca = 0 AND us > 0)::int AS "onlyInUs",
           count(*) FILTER (WHERE ca = 0 AND us = 0)::int AS "noStockAnywhere"
    FROM per_offer`);
  const warehouses = await many<DataQualityReport['stock']['warehouses'][number]>(db, `
    SELECT warehouse_id AS "warehouseId", max(location) AS location, max(country) AS country,
           count(*)::int AS products, count(*) FILTER (WHERE quantity_available > 0)::int AS "withStock"
    FROM offer_stock GROUP BY warehouse_id ORDER BY max(country) NULLS LAST, warehouse_id`);

  const latest = await one<{ id: number; started_at: Date; status: string; notes: string[] } | undefined>(db, `
    SELECT id, started_at, status, notes FROM sync_run WHERE job_type = 'catalog' AND status <> 'running'
    ORDER BY started_at DESC LIMIT 1`);
  const runId = latest?.id ?? -1;
  const excludedByReason = await many<{ reason: string; count: number }>(db, `
    SELECT reason, count(*)::int AS count FROM excluded_listing WHERE run_id = $1 GROUP BY 1 ORDER BY 2 DESC`, [runId]);
  const unrecognizedManufacturers = await many<{ name: string; count: number }>(db, `
    SELECT COALESCE(manufacturer_raw, '(blank)') AS name, count(*)::int AS count FROM excluded_listing
    WHERE run_id = $1 AND reason = 'Manufacturer name not recognized' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, [runId]);
  const categoryTranslation = await many<DataQualityReport['categoryTranslation'][number]>(db, `
    SELECT "distributorCategory", "distributorSubcategory", outcome, sum(n)::int AS count FROM (
      SELECT COALESCE(distributor_category, '(none)') AS "distributorCategory",
             COALESCE(distributor_subcategory, '(none)') AS "distributorSubcategory",
             category AS outcome, count(*) AS n
      FROM distributor_offer WHERE listed GROUP BY 1, 2, 3
      UNION ALL
      SELECT COALESCE(distributor_category, '(none)'), COALESCE(distributor_subcategory, '(none)'),
             'Left out: ' || reason, count(*)
      FROM excluded_listing WHERE run_id = $1 AND reason <> 'Manufacturer name not recognized' GROUP BY 1, 2, 3
    ) t GROUP BY 1, 2, 3 ORDER BY 1, 2, 4 DESC`, [runId]);

  const matchReview = await many<{ reason: string; count: number }>(db, `
    SELECT reason, count(*)::int AS count FROM match_review WHERE status = 'open' GROUP BY 1 ORDER BY 2 DESC`);
  const recentRuns = await many<DataQualityReport['recentRuns'][number]>(db, `
    SELECT id, job_type AS "jobType", trigger, started_at AS "startedAt", finished_at AS "finishedAt", status, counts,
           error_summary AS "errorSummary"
    FROM sync_run ORDER BY started_at DESC LIMIT 10`);

  return {
    generatedAt: new Date(),
    totals,
    byManufacturerCategory,
    hidden,
    completeness,
    detailsFetched: c.details!,
    pricing: {
      priced: p.priced!, neverPriced: p.neverPriced!, withPriceError: p.withPriceError!, stale: p.stale!,
      currencies, withMsrp: p.withMsrp!, withEhf: p.withEhf!, withQuantityBreaks: p.withQuantityBreaks!,
      withSpecialPricing: p.withSpecialPricing!, otherFees, topErrors,
    },
    stock: { inStockCanada: s.inStockCanada!, onlyInUs: s.onlyInUs!, noStockAnywhere: s.noStockAnywhere!, warehouses },
    latestCatalogRun: latest ? { id: latest.id, startedAt: latest.started_at, status: latest.status, notes: latest.notes } : null,
    excludedByReason,
    unrecognizedManufacturers,
    categoryTranslation,
    matchReview,
    recentRuns,
  };
}

function pct(have: number, of: number): string {
  return of === 0 ? '-' : `${Math.round((have / of) * 100)}%`;
}

/** Plain-language observations: the things worth Chris's attention. */
export function findings(r: DataQualityReport): string[] {
  const out: string[] = [];
  const shown = r.totals.shown;
  if (r.totals.offers === 0) return ['The catalog is empty. Run a full catalog pull first.'];
  const nonCad = r.pricing.currencies.filter((c) => c.currency !== 'CAD' && c.currency !== '(none)');
  if (nonCad.length) out.push(`Some prices are not in Canadian dollars: ${nonCad.map((c) => `${c.count} in ${c.currency}`).join(', ')}.`);
  if (r.pricing.withEhf === 0 && r.pricing.priced > 0) out.push('No environmental handling fees (EHF) came back with any price. Either Ingram doesn\'t send them for this account, or they arrive under a name we don\'t recognise yet (see "Other fees").');
  if (r.pricing.stale) out.push(`${r.pricing.stale} prices are more than ${STALE_HOURS} hours old and are marked "may be out of date".`);
  if (r.pricing.neverPriced) out.push(`${r.pricing.neverPriced} products have never had a price check.`);
  if (r.pricing.withPriceError) out.push(`${r.pricing.withPriceError} products failed their latest price check (last good price kept).`);
  const unknownWarehouses = r.stock.warehouses.filter((w) => !w.country);
  if (unknownWarehouses.length) {
    out.push(
      `${unknownWarehouses.length} warehouses couldn't be identified as Canadian or US, so their stock doesn't count as In Stock: ` +
      `${unknownWarehouses.map((w) => `${w.warehouseId} (${w.location ?? 'no location given'})`).join(', ')}. Tell us which are Canadian and we'll add them to the scope settings.`,
    );
  }
  const specs = r.completeness.find((c) => c.field === 'Specifications')!;
  if (r.detailsFetched > specs.have) {
    out.push(`Ingram answered the product-details request for ${r.detailsFetched} products, but specifications could be read for only ${specs.have}. The stored replies can be re-read once we see how Ingram lays them out.`);
  }
  if (shown && specs.have / shown < 0.5) out.push(`Only ${pct(specs.have, shown)} of products have specifications. Searching by RAM, CPU or screen size will need another source (e.g. a content provider).`);
  const images = r.completeness.find((c) => c.field === 'Images')!;
  if (shown && images.have === 0) out.push('No products have images. Ingram\'s API doesn\'t supply them; a content provider will be needed for the storefront.');
  if (r.unrecognizedManufacturers.length) out.push(`Some products came back under manufacturer names we don't recognise (${r.unrecognizedManufacturers.slice(0, 5).map((u) => u.name).join(', ')}). If any of these are really Lenovo, HP or Dell, add them to the scope file.`);
  const reviews = r.matchReview.reduce((a, b) => a + b.count, 0);
  if (reviews) out.push(`${reviews} products need a person to confirm which product they are (match review).`);
  for (const note of r.latestCatalogRun?.notes ?? []) out.push(note);
  return out;
}

export function reportAsText(r: DataQualityReport): string {
  const lines: string[] = [];
  const add = (s = '') => lines.push(s);
  add(`DATA-QUALITY REPORT  (${r.generatedAt.toLocaleString('en-CA', { timeZone: 'America/Vancouver' })} Pacific)`);
  add();
  add(`Products in the catalog: ${r.totals.shown} shown in search (${r.totals.offers} listed by Ingram in total).`);
  for (const row of r.byManufacturerCategory) add(`  ${row.manufacturer.padEnd(12)} ${row.category.padEnd(18)} ${row.count}`);
  add(`Hidden: ${r.hidden.discontinued} discontinued, ${r.hidden.notAuthorized} not authorized for purchase, ${r.hidden.refurbished} refurbished, ${r.hidden.noLongerListed} no longer listed.`);
  add();
  add('What the products come with:');
  for (const f of r.completeness) add(`  ${f.field.padEnd(26)} ${String(f.have).padStart(6)} of ${f.of}  (${pct(f.have, f.of)})`);
  add();
  add(`Prices: ${r.pricing.priced} priced, ${r.pricing.neverPriced} never priced, ${r.pricing.stale} out of date, ${r.pricing.withPriceError} with errors.`);
  add(`  Currencies: ${r.pricing.currencies.map((c) => `${c.currency} ${c.count}`).join(', ') || '-'}`);
  add(`  With MSRP ${r.pricing.withMsrp}, with EHF ${r.pricing.withEhf}, with quantity breaks ${r.pricing.withQuantityBreaks}, with special pricing ${r.pricing.withSpecialPricing}.`);
  if (r.pricing.otherFees.length) add(`  Other fees seen: ${r.pricing.otherFees.map((f) => `${f.description} (${f.count})`).join(', ')}`);
  add();
  add(`Stock: ${r.stock.inStockCanada} in stock in Canada, ${r.stock.onlyInUs} only in US warehouses, ${r.stock.noStockAnywhere} out of stock everywhere.`);
  for (const w of r.stock.warehouses) add(`  Warehouse ${w.warehouseId.padEnd(5)} ${(w.location ?? '(no location)').padEnd(24)} ${(w.country ?? '??').padEnd(3)} ${w.withStock} of ${w.products} products in stock`);
  add();
  add('Left out of the catalog (last catalog pull):');
  for (const e of r.excludedByReason) add(`  ${e.reason.padEnd(40)} ${e.count}`);
  add();
  const fs = findings(r);
  add('Things to look at:');
  for (const f of fs.length ? fs : ['Nothing stands out.']) add(`  - ${f}`);
  return lines.join('\n');
}
