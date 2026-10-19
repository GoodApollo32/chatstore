import express from 'express';
import type { Db } from '../db/pool.js';
import type { JobRunner } from '../jobs/runner.js';
import { buildReport, findings, SHOWN, STALE_HOURS, type DataQualityReport } from '../report/dataQuality.js';
import type { Scope } from '../scope.js';
import { ago, esc, money, page, when } from './html.js';

// The internal search page. Shows raw cost, so it must never be reachable by customers: Docker
// publishes it on this PC only, and Microsoft sign-in is added before anyone else uses it.

const PAGE_SIZE = 100;

export function createServer(db: Db, runner: JobRunner, loadScopeNow: () => Scope): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => void res.json({ ok: true }));

  app.get('/', async (req, res, next) => {
    try {
      res.send(await searchPage(db, loadScopeNow(), req.query as Record<string, string>));
    } catch (err) {
      next(err);
    }
  });

  app.get('/product/:id', async (req, res, next) => {
    try {
      const html = await productPage(db, Number(req.params.id));
      if (!html) return void res.status(404).send(page('Not found', '<h1>Product not found</h1>'));
      res.send(html);
    } catch (err) {
      next(err);
    }
  });

  app.get('/updates', async (req, res, next) => {
    try {
      res.send(await updatesPage(db, runner, typeof req.query.msg === 'string' ? req.query.msg : null));
    } catch (err) {
      next(err);
    }
  });

  app.post('/updates/:kind', (req, res) => {
    const kind = req.params.kind === 'catalog' ? 'catalog' : req.params.kind === 'price-stock' ? 'price_stock' : null;
    if (!kind) return void res.status(404).send('Unknown update');
    const r = runner.startInBackground(kind, 'manual');
    const msg = r.started
      ? kind === 'catalog' ? 'Full catalog pull started.' : 'Price & stock refresh started.'
      : r.reason!;
    res.redirect(303, `/updates?msg=${encodeURIComponent(msg)}`);
  });

  app.get('/report', async (_req, res, next) => {
    try {
      res.send(reportPage(await buildReport(db)));
    } catch (err) {
      next(err);
    }
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).send(page('Error', `<h1>Something went wrong</h1><p>${esc(err.message)}</p>`));
  });
  return app;
}

async function searchPage(db: Db, scope: Scope, q: Record<string, string>): Promise<string> {
  const where: string[] = [];
  const params: unknown[] = [];
  const param = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (q.showHidden !== 'on') where.push(SHOWN);
  else where.push('o.listed');
  for (const word of (q.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    const p = param(`%${word}%`);
    where.push(`(o.title ILIKE ${p} OR o.mpn_raw ILIKE ${p} OR o.distributor_sku ILIKE ${p} OR o.upc ILIKE ${p} OR m.description ILIKE ${p})`);
  }
  if (q.manufacturer) where.push(`m.manufacturer = ${param(q.manufacturer)}`);
  if (q.category) where.push(`o.category = ${param(q.category)}`);
  if (q.inStock === 'on') where.push(`ca.qty > 0`);
  if (q.minCost && Number.isFinite(Number(q.minCost))) where.push(`o.cost >= ${param(Number(q.minCost))}`);
  if (q.maxCost && Number.isFinite(Number(q.maxCost))) where.push(`o.cost <= ${param(Number(q.maxCost))}`);
  const pageNo = Math.max(1, Number(q.page) || 1);
  const sort = q.sort === 'cost' ? 'o.cost ASC NULLS LAST' : q.sort === 'cost-desc' ? 'o.cost DESC NULLS LAST'
    : q.sort === 'stock' ? 'ca.qty DESC, o.title' : 'm.manufacturer, o.category, o.title';

  const sql = `
    SELECT o.id, m.manufacturer, o.mpn_raw, o.title, o.category, o.distributor_sku, o.cost, o.ehf, o.msrp, o.currency,
           o.quantity_breaks, o.special_pricing, o.price_stock_refreshed_at, o.price_stock_error,
           o.discontinued, o.authorized_to_purchase, o.refurbished, o.master_product_id,
           ca.qty AS ca_qty, us.qty AS us_qty, count(*) OVER () AS total
    FROM distributor_offer o
    LEFT JOIN master_product m ON m.id = o.master_product_id
    LEFT JOIN LATERAL (SELECT COALESCE(sum(quantity_available), 0)::int AS qty FROM offer_stock WHERE offer_id = o.id AND country = 'CA') ca ON true
    LEFT JOIN LATERAL (SELECT COALESCE(sum(quantity_available), 0)::int AS qty FROM offer_stock WHERE offer_id = o.id AND country = 'US') us ON true
    WHERE ${where.join(' AND ')}
    ORDER BY ${sort}
    LIMIT ${PAGE_SIZE} OFFSET ${(pageNo - 1) * PAGE_SIZE}`;
  const { rows } = await db.query(sql, params);
  const total = rows[0]?.total ?? 0;

  const opt = (value: string, label: string, current: string | undefined) =>
    `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(label)}</option>`;
  const filters = `
    <form class="filters card" method="get">
      <label>Keyword, part number or SKU<input name="q" value="${esc(q.q ?? '')}" size="28" autofocus></label>
      <label>Manufacturer<select name="manufacturer">${opt('', 'All', q.manufacturer)}${scope.manufacturers.map((m) => opt(m.name, m.name, q.manufacturer)).join('')}</select></label>
      <label>Category<select name="category">${opt('', 'All', q.category)}${scope.categories.map((c) => opt(c, c, q.category)).join('')}</select></label>
      <label>Cost from<input name="minCost" value="${esc(q.minCost ?? '')}" size="7" inputmode="decimal"></label>
      <label>to<input name="maxCost" value="${esc(q.maxCost ?? '')}" size="7" inputmode="decimal"></label>
      <label>Sort<select name="sort">${opt('', 'Manufacturer', q.sort)}${opt('cost', 'Cost: low to high', q.sort)}${opt('cost-desc', 'Cost: high to low', q.sort)}${opt('stock', 'Most Canadian stock', q.sort)}</select></label>
      <label><span><input type="checkbox" name="inStock" ${q.inStock === 'on' ? 'checked' : ''}> In stock in Canada</span></label>
      <label><span><input type="checkbox" name="showHidden" ${q.showHidden === 'on' ? 'checked' : ''}> Include discontinued / restricted</span></label>
      <button type="submit">Search</button> <a href="/" class="small">clear</a>
    </form>`;

  const staleCutoff = Date.now() - STALE_HOURS * 3600_000;
  const body = rows.map((r: any) => {
    const tags: string[] = [];
    if (r.discontinued) tags.push('<span class="tag bad">discontinued</span>');
    if (!r.authorized_to_purchase) tags.push('<span class="tag bad">not authorized</span>');
    if (r.refurbished) tags.push('<span class="tag bad">refurbished</span>');
    if (!r.master_product_id) tags.push('<span class="tag warn">needs match review</span>');
    if (r.special_pricing?.length) tags.push('<span class="tag">special pricing</span>');
    const stale = r.price_stock_refreshed_at && new Date(r.price_stock_refreshed_at).getTime() < staleCutoff;
    const breaks = (r.quantity_breaks ?? []).map((b: any) => `${b.minQuantity}+: ${money(b.amount, b.currency)}`).join('<br>');
    return `<tr>
      <td>${esc(r.manufacturer ?? '–')}</td>
      <td><a href="/product/${r.id}">${esc(r.mpn_raw ?? '–')}</a><div class="small muted">Ingram ${esc(r.distributor_sku)}</div></td>
      <td>${esc(r.title)}<div>${tags.join('')}</div></td>
      <td>${esc(r.category)}</td>
      <td class="num">${money(r.cost, r.currency)}${r.ehf != null ? `<div class="small muted">+ EHF ${money(r.ehf)}</div>` : ''}${breaks ? `<div class="small muted">${breaks}</div>` : ''}</td>
      <td class="num">${money(r.msrp, r.currency)}</td>
      <td class="num">${r.price_stock_refreshed_at ? `<b>${r.ca_qty}</b>` : '–'}</td>
      <td class="num muted">${r.price_stock_refreshed_at ? r.us_qty : '–'}</td>
      <td class="small">${ago(r.price_stock_refreshed_at)}${stale ? '<div><span class="tag warn">may be out of date</span></div>' : ''}${r.price_stock_error ? '<div><span class="tag bad">last check failed</span></div>' : ''}</td>
    </tr>`;
  }).join('');

  const qs = (n: number) => '?' + new URLSearchParams({ ...q, page: String(n) }).toString();
  const pager = total > PAGE_SIZE
    ? `<p class="small">${pageNo > 1 ? `<a href="${esc(qs(pageNo - 1))}">← previous</a> · ` : ''}page ${pageNo} of ${Math.ceil(total / PAGE_SIZE)}${pageNo * PAGE_SIZE < total ? ` · <a href="${esc(qs(pageNo + 1))}">next →</a>` : ''}</p>`
    : '';

  return page('Search', `<h1>Search products</h1>${filters}
    <p class="muted">${total} products found. Cost is our regular Ingram account price before EHF; stock counts Canadian warehouses only.</p>
    <div class="scroll"><table>
      <tr><th>Manufacturer</th><th>Part number</th><th>Product</th><th>Category</th><th class="num">Cost</th><th class="num">MSRP</th>
          <th class="num">Stock CA</th><th class="num">Stock US</th><th>Updated</th></tr>
      ${body || '<tr><td colspan="9" class="muted">No products match. If the catalog is empty, start a full catalog pull on the Updates page.</td></tr>'}
    </table></div>${pager}`);
}

async function productPage(db: Db, id: number): Promise<string | null> {
  if (!Number.isInteger(id)) return null;
  const { rows } = await db.query(
    `SELECT o.*, m.manufacturer, m.specs, m.image_urls, m.description AS long_description, m.mpn_normalized
     FROM distributor_offer o LEFT JOIN master_product m ON m.id = o.master_product_id WHERE o.id = $1`,
    [id],
  );
  const o = rows[0];
  if (!o) return null;
  const stock = (await db.query(
    `SELECT * FROM offer_stock WHERE offer_id = $1 ORDER BY country NULLS LAST, quantity_available DESC`, [id],
  )).rows;
  const reviews = (await db.query(`SELECT reason, created_at FROM match_review WHERE offer_id = $1 AND status = 'open'`, [id])).rows;

  const kv = (pairs: [string, string][]) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const specs = Object.entries(o.specs ?? {}) as [string, string][];
  const countryLabel = (c: string | null) => (c === 'CA' ? 'Canada' : c === 'US' ? 'United States' : '<span class="tag warn">unknown</span>');

  return page(o.title, `
    <p><a href="/">← back to search</a></p>
    <h1>${esc(o.title)}</h1>
    ${reviews.map((r: any) => `<div class="notice">Needs match review: ${esc(r.reason)}</div>`).join('')}
    <div class="card">${kv([
      ['Manufacturer', esc(o.manufacturer ?? `${o.manufacturer_raw} (not matched)`)],
      ['Manufacturer part number', esc(o.mpn_raw ?? '–')],
      ['UPC', esc(o.upc ?? '–')],
      ['Ingram SKU', esc(o.distributor_sku)],
      ['Our category', esc(o.category)],
      ['Ingram category', esc([o.distributor_category, o.distributor_subcategory].filter(Boolean).join(' › ') || '–')],
      ['Status', [o.discontinued ? 'Discontinued' : null, !o.authorized_to_purchase ? 'Not authorized for purchase' : null,
        o.refurbished ? 'Refurbished' : null, !o.listed ? 'No longer listed by Ingram' : null, o.direct_ship ? 'Ships direct from manufacturer' : null]
        .filter(Boolean).join(', ') || 'Active'],
    ])}</div>
    <h2>Price</h2>
    <div class="card">${kv([
      ['Cost', `<b>${money(o.cost, o.currency)}</b>`],
      ['EHF', o.ehf != null ? money(o.ehf) : 'none reported'],
      ['MSRP', money(o.msrp, o.currency)],
      ['Quantity breaks', (o.quantity_breaks ?? []).map((b: any) => `${b.minQuantity}+ units: ${money(b.amount, b.currency)}`).join('<br>') || 'none'],
      ['Other fees', (o.fees ?? []).filter((f: any) => !f.isEhf).map((f: any) => `${esc(f.description ?? f.code)}: ${money(f.amount, f.currency)}`).join('<br>') || 'none'],
      ['Special pricing (internal only, never applied)', (o.special_pricing ?? []).map((s: any) =>
        `${esc(s.type ?? 'Special')}${s.bidNumber ? ` #${esc(s.bidNumber)}` : ''}: ${money(s.discount)} off${s.expirationDate ? `, until ${esc(s.expirationDate)}` : ''}`).join('<br>') || 'none'],
      ['Last price & stock check', `${when(o.price_stock_refreshed_at)} (${ago(o.price_stock_refreshed_at)})`],
      ...(o.price_stock_error ? [['Last check failed', `<span class="tag bad">${esc(o.price_stock_error)}</span>`] as [string, string]] : []),
    ])}</div>
    <h2>Stock by warehouse</h2>
    <div class="scroll"><table><tr><th>Warehouse</th><th>Location</th><th>Country</th><th class="num">Available</th><th class="num">Back-ordered</th><th class="num">On order</th><th>Expected</th></tr>
      ${stock.map((w: any) => `<tr><td>${esc(w.warehouse_id)}</td><td>${esc(w.location ?? '–')}</td><td>${countryLabel(w.country)}</td>
        <td class="num"><b>${w.quantity_available}</b></td><td class="num">${w.quantity_backordered}</td><td class="num">${w.quantity_on_order}</td>
        <td class="small">${(w.backorder_etas ?? []).map((e: any) => `${e.quantity} on ${esc(e.etaDate)}`).join('<br>')}</td></tr>`).join('')
        || '<tr><td colspan="7" class="muted">No stock information yet.</td></tr>'}
    </table></div>
    <h2>Specifications</h2>
    <div class="card">${specs.length ? kv(specs.map(([k, v]) => [k, esc(v)])) : '<span class="muted">None supplied by Ingram.</span>'}
      ${o.long_description ? `<p>${esc(o.long_description)}</p>` : ''}</div>
    <h2>Raw data from Ingram</h2>
    <details class="card"><summary>Catalog search</summary><pre>${esc(JSON.stringify(o.raw_search, null, 2))}</pre></details>
    <details class="card"><summary>Price &amp; availability</summary><pre>${esc(JSON.stringify(o.raw_price_stock, null, 2))}</pre></details>
    ${o.raw_details ? `<details class="card"><summary>Product details</summary><pre>${esc(JSON.stringify(o.raw_details, null, 2))}</pre></details>` : ''}
  `);
}

const JOB_LABEL: Record<string, string> = { catalog: 'Full catalog pull', price_stock: 'Price & stock refresh' };
const STATUS_TAG: Record<string, string> = {
  succeeded: '<span class="tag good">finished</span>', partial: '<span class="tag warn">finished with some failures</span>',
  failed: '<span class="tag bad">failed</span>', interrupted: '<span class="tag bad">interrupted</span>', running: '<span class="tag">running…</span>',
};

function describeCounts(jobType: string, c: any): string {
  if (!c || Object.keys(c).length === 0) return '';
  if (jobType === 'price_stock') return `${c.refreshed ?? 0} of ${c.requested ?? 0} updated · ${c.failed ?? 0} failed · ${c.costChanged ?? 0} cost changes · ${c.inStockCanada ?? 0} in stock in Canada`;
  const excluded = Object.values(c.excluded ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
  return `${c.fetched ?? 0} looked at · ${c.created ?? 0} new · ${c.updated ?? 0} changed · ${c.unchanged ?? 0} unchanged · ${excluded} left out · ${c.sentToMatchReview ?? 0} to match review · ${c.priced ?? 0} new priced`;
}

async function updatesPage(db: Db, runner: JobRunner, msg: string | null): Promise<string> {
  const runs = (await db.query(`SELECT * FROM sync_run ORDER BY started_at DESC LIMIT 25`)).rows;
  const running = runs.find((r: any) => r.status === 'running');
  return page('Updates', `
    ${running ? '<meta http-equiv="refresh" content="10">' : ''}
    <h1>Updates</h1>
    ${msg ? `<div class="notice">${esc(msg)}</div>` : ''}
    ${runner.lastError ? `<div class="notice">Last update stopped with an error: ${esc(runner.lastError)}</div>` : ''}
    <div class="card">
      <form method="post" action="/updates/price-stock" style="display:inline"><button ${running ? 'disabled' : ''}>Refresh prices &amp; stock now</button></form>
      <form method="post" action="/updates/catalog" style="display:inline"><button class="secondary" ${running ? 'disabled' : ''}>Run full catalog pull now</button></form>
      <p class="small muted">The price &amp; stock refresh takes a few minutes. The full catalog pull finds new and removed products and can take much longer; it also prices any new products it finds. ${running ? 'This page refreshes itself while an update is running.' : ''}</p>
    </div>
    ${await connectionPanel(db, running)}
    <h2>Recent updates</h2>
    <div class="scroll"><table><tr><th>Started</th><th>What</th><th>How</th><th>Result</th><th>Numbers</th></tr>
      ${runs.map((r: any) => `<tr><td>${when(r.started_at)}</td><td>${JOB_LABEL[r.job_type] ?? r.job_type}</td>
        <td class="small">${r.trigger === 'schedule' ? 'automatic' : r.trigger === 'manual' ? 'button' : 'command'}</td>
        <td>${STATUS_TAG[r.status] ?? esc(r.status)}${r.error_summary ? `<div class="small muted">${esc(r.error_summary)}</div>` : ''}
            ${(r.notes ?? []).map((n: string) => `<div class="small">${esc(n)}</div>`).join('')}</td>
        <td class="small">${esc(describeCounts(r.job_type, r.counts))}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">Nothing has run yet.</td></tr>'}
    </table></div>`);
}

// No call to Ingram for this long while an update is running means it's probably stuck. Retries and
// back-off waits are logged as calls too, so a healthy update is never quiet for this long, except
// while it waits for Ingram's rate-limit allowance to reset (then counted from the reset time).
const STUCK_MINUTES = 5;

/** What Ingram has been telling us: recent calls, rate-limit allowance and "slow down" replies, errors. */
async function connectionPanel(db: Db, running: any): Promise<string> {
  const { rows: [last] } = await db.query(`SELECT at, status, error FROM api_call_log ORDER BY id DESC LIMIT 1`);
  if (!last) return '';
  const { rows: [hour] } = await db.query(
    `SELECT count(*)::int AS calls,
            count(*) FILTER (WHERE status = 429)::int AS slow_down,
            count(*) FILTER (WHERE status IS NULL OR status >= 500)::int AS errors
     FROM api_call_log WHERE at > now() - interval '1 hour'`,
  );
  const { rows: [limited] } = await db.query(
    `SELECT at, error FROM api_call_log WHERE status = 429 AND at > now() - interval '24 hours' ORDER BY id DESC LIMIT 1`,
  );
  const { rows: [allowance] } = await db.query(
    `SELECT rate_limit_limit AS "limit", rate_limit_remaining AS remaining, rate_limit_reset AS reset, status
     FROM api_call_log WHERE rate_limit_limit IS NOT NULL OR rate_limit_remaining IS NOT NULL OR rate_limit_reset IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
  );
  const now = Date.now();
  const resetAt = allowance?.reset ? new Date(allowance.reset).getTime() : 0;
  const waitingForReset = running && resetAt > now && (allowance.status === 429 || allowance.remaining === 0);
  const quietSince = Math.max(new Date(last.at).getTime(), resetAt <= now ? resetAt : 0);
  const quietMinutes = (now - quietSince) / 60_000;
  const runningMinutes = running ? (now - new Date(running.started_at).getTime()) / 60_000 : 0;
  const stuck = running && !waitingForReset && quietMinutes >= STUCK_MINUTES && runningMinutes >= STUCK_MINUTES;
  const lastResult = last.status === null ? 'no reply' : last.status === 429 ? 'asked us to slow down' : last.status < 400 ? 'OK' : `error ${last.status}`;
  const minutesTo = (t: number) => Math.max(1, Math.round((t - now) / 60_000));

  return `<h2>Connection to Ingram</h2>
    ${waitingForReset ? `<div class="notice"><b>Paused for Ingram's rate limit.</b> Our allowance is used up until ${when(new Date(resetAt))}
      (in about ${minutesTo(resetAt)} min). The update carries on by itself after that; you don't need to do anything.</div>` : ''}
    ${stuck ? `<div class="notice"><b>This update looks stuck.</b> Nothing has been heard from Ingram for ${Math.round(quietMinutes)} minutes.
      Double-click <b>Stop Catalog</b>, then <b>Start Catalog</b>. A catalog pull continues where it stopped.</div>` : ''}
    ${limited && !waitingForReset ? `<div class="notice"><b>Rate limit:</b> Ingram asked us to slow down ${ago(limited.at)} (${when(limited.at)}).
      The program waits until Ingram's allowance resets and then carries on; if that's more than an hour away, the update
      stops with a "rate limit" message below saying when to run it again.
      ${limited.error ? `<div class="small">Ingram said: ${esc(limited.error)}</div>` : ''}</div>` : ''}
    <div class="card small">
      Last request to Ingram: ${ago(last.at)} (${when(last.at)}), result: ${esc(lastResult)}${last.error && last.status !== 429 ? ` (${esc(last.error)})` : ''}.<br>
      Last hour: ${hour.calls} requests, ${hour.slow_down} "slow down" (rate limit) replies, ${hour.errors} errors or no reply.<br>
      ${allowance
        ? `Ingram's allowance at the last reply: ${allowance.remaining ?? '?'} of ${allowance.limit ?? '?'} requests left${resetAt ? `, ${resetAt > now ? 'resets' : 'reset'} ${when(new Date(resetAt))}` : ''}.`
        : "Ingram hasn't reported a rate-limit allowance yet."}
      ${!limited ? '<br>No rate limiting from Ingram in the last 24 hours.' : ''}
    </div>`;
}

function reportPage(r: DataQualityReport): string {
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const fs = findings(r);
  const table = (head: string[], rows: (string | number)[][], numCols: number[] = []) =>
    `<div class="scroll"><table><tr>${head.map((h, i) => `<th${numCols.includes(i) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr>
      ${rows.map((row) => `<tr>${row.map((c, i) => `<td${numCols.includes(i) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="muted">None</td></tr>`}</table></div>`;

  return page('Data-quality report', `
    <h1>Data-quality report</h1>
    <p class="muted">As of ${when(r.generatedAt)} · Latest catalog pull: ${r.latestCatalogRun ? `${when(r.latestCatalogRun.startedAt)} (${esc(r.latestCatalogRun.status)})` : 'none yet'}.</p>
    <div class="card"><b>Things to look at</b><ul>${(fs.length ? fs : ['Nothing stands out.']).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>

    <h2>What's in the catalog</h2>
    <p>${r.totals.shown} products shown in search. Hidden: ${r.hidden.discontinued} discontinued, ${r.hidden.notAuthorized} not authorized for purchase, ${r.hidden.refurbished} refurbished, ${r.hidden.noLongerListed} no longer listed by Ingram.</p>
    ${table(['Manufacturer', 'Category', 'Products'], r.byManufacturerCategory.map((x) => [x.manufacturer, x.category, x.count]), [2])}

    <h2>What the products come with</h2>
    ${table(['Information', 'Products that have it', 'Share'], r.completeness.map((x) => [x.field, `${x.have} of ${x.of}`, pct(x.have, x.of)]), [1, 2])}

    <h2>Prices</h2>
    ${table(['', 'Products'], [
      ['Priced', r.pricing.priced], ['Never priced', r.pricing.neverPriced], [`Out of date (older than ${STALE_HOURS} h)`, r.pricing.stale],
      ['Latest price check failed', r.pricing.withPriceError], ['Have an MSRP', r.pricing.withMsrp], ['Have an EHF', r.pricing.withEhf],
      ['Have quantity breaks', r.pricing.withQuantityBreaks], ['Have special pricing (shown internally only)', r.pricing.withSpecialPricing],
      ...r.pricing.currencies.map((c) => [`Priced in ${c.currency}`, c.count] as [string, number]),
    ], [1])}
    ${r.pricing.otherFees.length ? `<p><b>Other fees Ingram reported</b> (not counted as EHF):</p>${table(['Fee', 'Products'], r.pricing.otherFees.map((f) => [f.description, f.count]), [1])}` : ''}
    ${r.pricing.topErrors.length ? `<p><b>Most common price-check errors</b></p>${table(['Error', 'Products'], r.pricing.topErrors.map((e) => [e.error, e.count]), [1])}` : ''}

    <h2>Stock</h2>
    <p>${r.stock.inStockCanada} in stock in Canada · ${r.stock.onlyInUs} only in US warehouses · ${r.stock.noStockAnywhere} out of stock everywhere.</p>
    ${table(['Warehouse', 'Location', 'Counted as', 'Products listed', 'With stock'],
      r.stock.warehouses.map((w) => [w.warehouseId, w.location ?? '(no location)', w.country === 'CA' ? 'Canada' : w.country === 'US' ? 'United States' : 'Unknown', w.products, w.withStock]), [3, 4])}

    <h2>Left out of the catalog</h2>
    <p class="muted">From the latest catalog pull. Parts, bags, warranties, refurbished units and other categories are counted here but not kept.</p>
    ${table(['Reason', 'Products'], r.excludedByReason.map((e) => [e.reason, e.count]), [1])}
    ${r.unrecognizedManufacturers.length ? `<p><b>Manufacturer names we didn't recognise</b></p>${table(['Name used by Ingram', 'Products'], r.unrecognizedManufacturers.map((u) => [u.name, u.count]), [1])}` : ''}

    <h2>How Ingram's categories were translated</h2>
    <p class="muted">Check this after each pull: a wrong line here means a rule in the scope file needs adjusting.</p>
    ${table(['Ingram category', 'Ingram sub-category', 'Became', 'Products'], r.categoryTranslation.map((t) => [t.distributorCategory, t.distributorSubcategory, t.outcome, t.count]), [3])}

    <h2>Match review</h2>
    ${table(['Reason', 'Products'], r.matchReview.map((m) => [m.reason, m.count]), [1])}
  `);
}
