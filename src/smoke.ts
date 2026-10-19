import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIngramConfig } from './config.js';
import { DetailsUnavailableError } from './domain/types.js';
import type { ApiCallRecord } from './ingram/client.js';
import { IngramConnector } from './ingram/connector.js';
import { parsePriceAndAvailability } from './ingram/parse.js';
import type { Scope } from './scope.js';

/**
 * Connection check: signs in, fetches one page of the catalog, prices a few products and tries
 * product details. Prints what it learned in plain language and saves the raw responses
 * (recordings/) so they can become test fixtures. Touches no database.
 */
export async function smokeTest(scope: Scope, recordingsDir = 'recordings'): Promise<boolean> {
  const config = loadIngramConfig();
  const calls: ApiCallRecord[] = [];
  const connector = new IngramConnector(config, scope.warehouseCountries, { onCall: (c) => calls.push(c), maxAttempts: 3 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(recordingsDir, { recursive: true });
  const save = (name: string, body: unknown) => writeFileSync(join(recordingsDir, `${config.env}-${stamp}-${name}.json`), JSON.stringify(body, null, 2));
  const say = (s = '') => console.log(s);

  say(`Connection check against Ingram ${config.env.toUpperCase()} (country ${config.countryCode}, customer ${config.customerNumber})`);
  say();
  let ok = true;
  try {
    await connector.client.accessToken();
    say('✔ Signed in to Ingram.');
  } catch (err) {
    say(`✘ Could not sign in: ${(err as Error).message}`);
    say('  Check INGRAM_CLIENT_ID and INGRAM_CLIENT_SECRET, and that INGRAM_ENV matches the app (sandbox or production).');
    printCalls(calls);
    return false;
  }

  const manufacturer = scope.manufacturers[0]!;
  let skus: string[] = [];
  try {
    const { page, raw } = await connector.searchPage(manufacturer.ingramSearch, 1, 10);
    save('search', raw);
    say(`✔ Catalog search works: ${page.totalRecords ?? '?'} ${manufacturer.name} products listed; first page:`);
    for (const l of page.listings) say(`    ${l.distributorSku.padEnd(10)} ${(l.mpnRaw ?? '-').padEnd(18)} ${l.manufacturerRaw.padEnd(10)} ${[l.distributorCategory, l.distributorSubcategory].filter(Boolean).join(' › ')} | ${l.title.slice(0, 60)}`);
    skus = page.listings.map((l) => l.distributorSku);
  } catch (err) {
    ok = false;
    say(`✘ Catalog search failed: ${(err as Error).message}`);
  }

  if (skus.length) {
    try {
      const { status, body } = await connector.priceAndStockRaw(skus, true);
      save('price-and-availability', body);
      const results = parsePriceAndAvailability(body, scope.warehouseCountries);
      const good = results.filter((r) => r.ok);
      say(`✔ Price & availability works (HTTP ${status}): ${good.length} of ${results.length} products priced.`);
      const currencies = new Set(good.map((r) => (r.ok ? r.currency : null)));
      say(`    Currency: ${[...currencies].join(', ') || 'none reported'}`);
      for (const r of results) {
        if (!r.ok) {
          say(`    ${r.distributorSku.padEnd(10)} error: ${r.error}`);
          continue;
        }
        const ca = r.stock.filter((w) => w.country === 'CA').reduce((a, w) => a + w.quantityAvailable, 0);
        say(`    ${r.distributorSku.padEnd(10)} cost ${r.cost ?? '-'}  MSRP ${r.msrp ?? '-'}  EHF ${r.ehf ?? '-'}  CA stock ${ca}  specs ${Object.keys(r.specs).length}  fees ${r.fees.length}`);
      }
      const warehouses = new Map<string, string>();
      for (const r of good) if (r.ok) for (const w of r.stock) warehouses.set(w.warehouseId, `${w.location ?? '(no location)'} → ${w.country ?? 'UNKNOWN'}`);
      say('    Warehouses seen:');
      for (const [id, desc] of warehouses) say(`      ${id.padEnd(5)} ${desc}`);
    } catch (err) {
      ok = false;
      say(`✘ Price & availability failed: ${(err as Error).message}`);
    }

    try {
      const d = await connector.details(skus[0]!);
      save('details', d.raw);
      say(`✔ Product details work for this country: ${Object.keys(d.specs).length} specs, ${d.imageUrls.length} images for ${skus[0]}.`);
    } catch (err) {
      if (err instanceof DetailsUnavailableError) say(`• Product details are not available here (${err.message}).`);
      else {
        ok = false;
        say(`✘ Product details failed: ${(err as Error).message}`);
      }
    }
  }

  printCalls(calls);
  say(`Raw responses saved in ${recordingsDir}/`);
  return ok;
}

function printCalls(calls: ApiCallRecord[]): void {
  console.log('\nCalls made (correlation IDs for Ingram support):');
  for (const c of calls) console.log(`  ${c.method.padEnd(4)} ${c.path.padEnd(48)} ${String(c.status ?? 'network error').padEnd(4)} ${c.durationMs}ms  ${c.correlationId}${c.error ? `  ${c.error}` : ''}`);
}
