import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db } from '../src/db/pool.js';
import { DetailsUnavailableError, type CatalogListing, type CatalogPage, type DistributorConnector, type PriceStock } from '../src/domain/types.js';
import { runCatalogSync } from '../src/jobs/catalogSync.js';
import { runPriceStockRefresh } from '../src/jobs/priceStock.js';
import { CallLogger, JobAlreadyRunningError, withJobLock } from '../src/jobs/runs.js';
import { buildReport, findings, reportAsText } from '../src/report/dataQuality.js';
import { loadScope } from '../src/scope.js';

// Runs the jobs against a real PostgreSQL with a stand-in distributor.
// Set TEST_DATABASE_URL to a throwaway database to run these.
const url = process.env.TEST_DATABASE_URL;
const scope = loadScope('config/scope.json');

function listing(sku: string, over: Partial<CatalogListing> = {}): CatalogListing {
  return {
    distributor: 'ingram', distributorSku: sku, manufacturerRaw: 'LENOVO', mpnRaw: `MPN-${sku}`, upc: null,
    title: `THINKPAD ${sku}`, distributorCategory: 'Computers', distributorSubcategory: 'Notebooks',
    discontinued: false, authorizedToPurchase: true, directShip: false, newProduct: false, raw: { sku, ...over }, ...over,
  };
}

function price(sku: string, cost: number, caQty: number, usQty = 0): PriceStock {
  return {
    ok: true, distributorSku: sku, cost, msrp: cost * 1.3, mapPrice: null, currency: 'CAD', ehf: 1.75,
    fees: [{ code: 'ZEHF', description: 'BC EHF', amount: 1.75, currency: 'CAD', isEhf: true }],
    quantityBreaks: [], specialPricing: [],
    stock: [
      { warehouseId: '70', location: 'Mississauga, ON', country: 'CA', quantityAvailable: caQty, quantityBackordered: 0, quantityOnOrder: 0, backorderEtas: [] },
      { warehouseId: '10', location: 'Mira Loma, CA', country: 'US', quantityAvailable: usQty, quantityBackordered: 0, quantityOnOrder: 0, backorderEtas: [] },
    ],
    specs: {}, raw: { sku },
  };
}

class FakeConnector implements DistributorConnector {
  readonly id = 'ingram' as const;
  readonly priceStockBatchSize = 2;
  pages: Record<string, CatalogListing[][]> = {};
  prices = new Map<string, PriceStock>();
  failOnPage: { vendor: string; page: number } | null = null;
  pagesRequested: string[] = [];

  async *catalogPages(vendor: string, startPage: number): AsyncIterable<CatalogPage> {
    const pages = this.pages[vendor] ?? [[]];
    for (let p = startPage; p <= pages.length; p++) {
      this.pagesRequested.push(`${vendor}:${p}`);
      if (this.failOnPage?.vendor === vendor && this.failOnPage.page === p) throw new Error('Ingram returned 503');
      yield { pageNumber: p, totalRecords: null, listings: pages[p - 1]!, isLastPage: p === pages.length };
    }
  }
  async priceAndStock(skus: string[]): Promise<PriceStock[]> {
    return skus.map((s) => this.prices.get(s) ?? { ok: false, distributorSku: s, error: 'Product not found', raw: null });
  }
  async details(): Promise<never> {
    throw new DetailsUnavailableError('Ingram returned 400: not available in CA');
  }
}

describe.skipIf(!url)('jobs against a real database', () => {
  let db: Db;
  let fake: FakeConnector;
  const run = (kind: 'catalog' | 'refresh') => {
    const callLogger = new CallLogger(db, 'ingram');
    return kind === 'catalog'
      ? runCatalogSync({ db, connector: fake, scope, callLogger, trigger: 'command' })
      : runPriceStockRefresh({ db, connector: fake, callLogger, trigger: 'command' });
  };
  const offer = async (sku: string) => (await db.query(`SELECT * FROM distributor_offer WHERE distributor_sku = $1`, [sku])).rows[0];

  beforeAll(async () => {
    db = createPool(url!);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
  });
  afterAll(async () => db?.end());

  beforeEach(async () => {
    await db.query('TRUNCATE master_product, distributor_offer, offer_stock, match_review, excluded_listing, sync_run, api_call_log CASCADE');
    fake = new FakeConnector();
    fake.pages = {
      Lenovo: [
        [
          listing('A1'),
          listing('A2', { distributorSubcategory: 'Notebook Batteries', title: 'THINKPAD BATTERY' }),
          listing('A3', { mpnRaw: null }),
          listing('A4', { title: 'REFURBISHED THINKPAD T14' }),
        ],
        [listing('A5', { distributorSubcategory: 'Docking Stations', title: 'THINKPAD USB-C DOCK' }), listing('A6', { manufacturerRaw: 'LENOVO SERVER GROUP' })],
      ],
      HP: [[
        listing('H1', { manufacturerRaw: 'HP INC', mpnRaw: '8A3B4UT#ABC', upc: '196068000001' }),
        listing('H2', { manufacturerRaw: 'HP INC', mpnRaw: '8A3B4UT#ABA', upc: '196068000002' }),
      ]],
      Dell: [[listing('D1', { manufacturerRaw: 'DELL', distributorCategory: 'Displays', distributorSubcategory: 'Monitors', title: 'DELL P2425H', discontinued: true })]],
    };
    for (const [sku, cost, ca] of [['A1', 1200, 5], ['A3', 900, 0], ['A5', 250, 12], ['H1', 1500, 0], ['H2', 1450, 3], ['D1', 300, 0]] as const) {
      fake.prices.set(sku, price(sku, cost, ca, 4));
    }
  });

  it('pulls the catalog: keeps in-scope products, counts the rest, prices new products', async () => {
    const result = await run('catalog');
    expect(result.status).toBe('succeeded');

    const offers = (await db.query(`SELECT distributor_sku, category FROM distributor_offer ORDER BY 1`)).rows;
    expect(offers).toEqual([
      { distributor_sku: 'A1', category: 'Laptops' }, { distributor_sku: 'A3', category: 'Laptops' },
      { distributor_sku: 'A5', category: 'Docking Stations' }, { distributor_sku: 'D1', category: 'Monitors' },
      { distributor_sku: 'H1', category: 'Laptops' }, { distributor_sku: 'H2', category: 'Laptops' },
    ]);
    const run1 = (await db.query(`SELECT counts, notes FROM sync_run WHERE id = $1`, [result.runId])).rows[0];
    expect(run1.counts).toMatchObject({
      fetched: 9, created: 6, priced: 6, priceFailed: 0, sentToMatchReview: 1,
      excluded: { 'Parts, bags and accessories': 1, 'Refurbished or open box': 1, 'Manufacturer name not recognized': 1 },
    });
    expect(run1.notes.join(' ')).toMatch(/details aren't available/);

    // HP regional variants are separate products; the product without an MPN waits for a person.
    const masters = (await db.query(`SELECT manufacturer, mpn_normalized FROM master_product ORDER BY 2`)).rows;
    expect(masters.filter((m) => m.manufacturer === 'HP').map((m) => m.mpn_normalized)).toEqual(['8A3B4UT#ABA', '8A3B4UT#ABC']);
    expect((await offer('A3')).master_product_id).toBeNull();
    expect((await db.query(`SELECT reason FROM match_review`)).rows).toEqual([{ reason: 'No manufacturer part number' }]);

    const a1 = await offer('A1');
    expect(a1).toMatchObject({ cost: 1200, ehf: 1.75, currency: 'CAD' });
    expect(a1.raw_search).toEqual({ sku: 'A1' });
    const stock = (await db.query(`SELECT warehouse_id, country, quantity_available FROM offer_stock WHERE offer_id = $1 ORDER BY 1`, [a1.id])).rows;
    expect(stock).toEqual([{ warehouse_id: '10', country: 'US', quantity_available: 4 }, { warehouse_id: '70', country: 'CA', quantity_available: 5 }]);
  });

  it('marks products Ingram stops listing, and counts unchanged ones', async () => {
    await run('catalog');
    fake.pages.HP = [[listing('H1', { manufacturerRaw: 'HP INC', mpnRaw: '8A3B4UT#ABC', upc: '196068000001' })]];
    const second = await run('catalog');
    const counts = (await db.query(`SELECT counts FROM sync_run WHERE id = $1`, [second.runId])).rows[0].counts;
    expect(counts).toMatchObject({ created: 0, unchanged: 5, noLongerListed: 1, priced: 0 });
    expect((await offer('H2')).listed).toBe(false);
  });

  it('sends a UPC conflict to match review instead of merging', async () => {
    await run('catalog');
    fake.pages.Dell = [[
      listing('D1', { manufacturerRaw: 'DELL', distributorCategory: 'Displays', distributorSubcategory: 'Monitors', title: 'DELL P2425H', discontinued: true, upc: '111111111111' }),
      listing('D9', { manufacturerRaw: 'DELL', mpnRaw: 'MPN-D1', upc: '999999999999', distributorSubcategory: 'Monitors', distributorCategory: 'Displays' }),
    ]];
    await run('catalog');
    expect((await offer('D9')).master_product_id).toBeNull();
    const reviews = (await db.query(`SELECT reason FROM match_review WHERE status = 'open' ORDER BY reason`)).rows.map((r) => r.reason);
    expect(reviews).toContain('Same manufacturer part number as an existing product, but a different UPC');
  });

  it('refreshes price & stock, keeping the last good price when a check fails', async () => {
    await run('catalog');
    fake.prices.set('A1', price('A1', 1150, 0, 9));
    fake.prices.delete('H2');
    const result = await run('refresh');
    expect(result.status).toBe('partial');
    const counts = (await db.query(`SELECT counts FROM sync_run WHERE id = $1`, [result.runId])).rows[0].counts;
    expect(counts).toMatchObject({ requested: 6, refreshed: 5, failed: 1, costChanged: 1 });
    expect(await offer('A1')).toMatchObject({ cost: 1150 });
    expect(await offer('H2')).toMatchObject({ cost: 1450, price_stock_error: 'Product not found' });
  });

  it('continues an interrupted catalog pull from where it stopped', async () => {
    fake.failOnPage = { vendor: 'Lenovo', page: 2 };
    await expect(run('catalog')).rejects.toThrow('503');
    const failed = (await db.query(`SELECT status, resume_state FROM sync_run ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(failed.status).toBe('failed');
    expect(failed.resume_state).toMatchObject({ manufacturerIndex: 0, nextPage: 2 });

    fake.failOnPage = null;
    fake.pagesRequested = [];
    const resumed = await run('catalog');
    expect(resumed.status).toBe('succeeded');
    expect(fake.pagesRequested).toEqual(['Lenovo:2', 'HP:1', 'Dell:1']);
    // Products from the first, interrupted part are not treated as delisted.
    expect((await offer('A1')).listed).toBe(true);
  });

  it('carries on when a manufacturer search finds nothing, without hiding existing products', async () => {
    await run('catalog');
    fake.pages.Dell = [[]];
    const result = await run('catalog');
    expect(result.status).toBe('partial');
    const notes = (await db.query(`SELECT notes FROM sync_run WHERE id = $1`, [result.runId])).rows[0].notes.join(' ');
    expect(notes).toMatch(/no products when searching for the manufacturer "Dell"/);
    expect(notes).toMatch(/may have dropped were not checked/);
    expect((await offer('D1')).listed).toBe(true);
    expect((await offer('H1')).listed).toBe(true);
  });

  it('only lets one update run at a time', async () => {
    await withJobLock(db, async () => {
      await expect(run('refresh')).rejects.toThrow(JobAlreadyRunningError);
    });
  });

  it('builds the data-quality report', async () => {
    await run('catalog');
    const r = await buildReport(db);
    expect(r.totals).toMatchObject({ offers: 6, shown: 5 }); // D1 is discontinued
    expect(r.hidden.discontinued).toBe(1);
    expect(r.stock.inStockCanada).toBe(3);
    expect(r.pricing.withEhf).toBe(5);
    expect(r.stock.warehouses.map((w) => [w.warehouseId, w.country])).toEqual([['70', 'CA'], ['10', 'US']]);
    expect(r.categoryTranslation).toContainEqual({ distributorCategory: 'Computers', distributorSubcategory: 'Notebook Batteries', outcome: 'Left out: Parts, bags and accessories', count: 1 });
    expect(r.unrecognizedManufacturers).toEqual([{ name: 'LENOVO SERVER GROUP', count: 1 }]);
    expect(findings(r).join(' ')).toMatch(/match review/);
    expect(reportAsText(r)).toContain('in stock in Canada');
  });

  it('shows rate limiting and a stuck update on the updates page', async () => {
    const { createServer } = await import('../src/web/server.js');
    const { JobRunner } = await import('../src/jobs/runner.js');
    const server = createServer(db, new JobRunner(db, 'config/scope.json'), () => scope).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const log = (status: number | null, minutesAgo: number, error: string | null = null) => db.query(
      `INSERT INTO api_call_log (distributor, correlation_id, method, path, status, duration_ms, attempt, error, at)
       VALUES ('ingram', 'c', 'GET', '/resellers/v6/catalog', $1, 10, 1, $2, now() - make_interval(mins => $3))`,
      [status, error, minutesAgo],
    );
    try {
      await log(200, 30);
      let html = await (await fetch(`${base}/updates`)).text();
      expect(html).toContain('No rate limiting from Ingram in the last 24 hours');
      expect(html).not.toContain('looks stuck');

      await log(429, 20, 'Rate limit quota violation. Quota limit exceeded');
      await db.query(`INSERT INTO sync_run (distributor, job_type, trigger, started_at) VALUES ('ingram', 'catalog', 'manual', now() - interval '25 minutes')`);
      html = await (await fetch(`${base}/updates`)).text();
      expect(html).toContain('Ingram asked us to slow down 20 min ago');
      expect(html).toContain('Quota limit exceeded');
      expect(html).toContain('1 "slow down" (rate limit) replies');
      expect(html).toContain('looks stuck');
      expect(html).toContain("Ingram hasn't reported a rate-limit allowance yet");

      // Allowance used up, resetting in 30 minutes: paused, not stuck.
      await db.query(
        `INSERT INTO api_call_log (distributor, correlation_id, method, path, status, duration_ms, attempt, error, at,
                                   rate_limit_limit, rate_limit_remaining, rate_limit_reset)
         VALUES ('ingram', 'c', 'GET', '/resellers/v6/catalog', 429, 10, 1, 'Too Many Requests', now() - interval '10 minutes',
                 500, 0, now() + interval '30 minutes')`,
      );
      html = await (await fetch(`${base}/updates`)).text();
      expect(html).toContain("Paused for Ingram's rate limit");
      expect(html).toContain('in about 30 min');
      expect(html).not.toContain('looks stuck');
      expect(html).toContain("Ingram's allowance at the last reply: 0 of 500 requests left, resets");
    } finally {
      server.close();
    }
  });

  it('serves the search, product, updates and report pages', async () => {
    await run('catalog');
    const { createServer } = await import('../src/web/server.js');
    const { JobRunner } = await import('../src/jobs/runner.js');
    const server = createServer(db, new JobRunner(db, 'config/scope.json'), () => scope).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const search = await (await fetch(`${base}/?q=8a3b4ut&inStock=on`)).text();
      expect(search).toContain('8A3B4UT#ABA');
      expect(search).not.toContain('8A3B4UT#ABC'); // no Canadian stock
      expect(search).toContain('1 products found');
      const all = await (await fetch(`${base}/?category=Laptops&showHidden=on`)).text();
      expect(all).toContain('needs match review');
      const id = (await offer('A1')).id;
      const product = await (await fetch(`${base}/product/${id}`)).text();
      expect(product).toContain('Mississauga, ON');
      expect(product).toContain('$1,200.00');
      expect(await (await fetch(`${base}/updates`)).text()).toContain('Full catalog pull');
      expect(await (await fetch(`${base}/report`)).text()).toContain('How Ingram&#39;s categories were translated'.replace('&#39;', "'"));
      expect((await fetch(`${base}/?q=%3Cscript%3E`)).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
