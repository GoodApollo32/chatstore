import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/pool.js';

// Icecat coverage check: looks up a sample of our products in Icecat's free catalog (Open Icecat) and
// reports how many have full specifications and images. Open Icecat only carries full data for brands
// that sponsor it; for others it needs a paid Full Icecat subscription. Raw replies are saved so the
// real import can be built against them. Read-only: nothing is written to the database.

const API = 'https://live.icecat.biz/api';
const PER_MANUFACTURER = 10;

export type IcecatOutcome = 'full' | 'basic' | 'paid-only' | 'not-found' | 'error';

export interface IcecatSummary {
  outcome: IcecatOutcome;
  title: string | null;
  features: number;
  images: number;
  message: string | null;
}

/** Classifies a reply from Icecat's live JSON API, tolerating either of its documented parameter generations. */
export function summarizeIcecatReply(status: number, body: any): IcecatSummary {
  const data = body?.data;
  const message = String(body?.Message ?? body?.message ?? body?.msg ?? body?.Error ?? '').trim() || null;
  if (data && (data.GeneralInfo || data.FeaturesGroups)) {
    const features = (Array.isArray(data.FeaturesGroups) ? data.FeaturesGroups : [])
      .reduce((n: number, g: any) => n + (Array.isArray(g?.Features) ? g.Features.length : 0), 0);
    const images = (Array.isArray(data.Gallery) ? data.Gallery.length : 0) || (data.Image?.HighPic || data.Image?.Pic500x500 ? 1 : 0);
    return { outcome: features > 0 ? 'full' : 'basic', title: data.GeneralInfo?.Title ?? null, features, images, message: null };
  }
  const text = `${message ?? ''} ${typeof body === 'string' ? body : ''}`;
  if (/full ?ice ?cat|not allowed|restricted|subscription|sponsor/i.test(text) || status === 403) {
    return { outcome: 'paid-only', title: null, features: 0, images: 0, message };
  }
  if (/not (be )?found|not present|no product|unknown product/i.test(text) || status === 404) {
    return { outcome: 'not-found', title: null, features: 0, images: 0, message };
  }
  return { outcome: 'error', title: null, features: 0, images: 0, message: message ?? `HTTP ${status}` };
}

/** Product codes worth trying for one product: its barcode, its part number, and the part number without a region code. */
export function lookupsFor(p: { manufacturer: string; mpn: string; upc: string | null }): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  if (p.upc && /^\d{8,14}$/.test(p.upc)) out.push({ GTIN: p.upc });
  out.push({ Brand: p.manufacturer, ProductCode: p.mpn });
  const base = p.mpn.replace(/#\w+$/, '');
  if (base !== p.mpn) out.push({ Brand: p.manufacturer, ProductCode: base });
  return out;
}

export async function icecatCheck(db: Db, username: string, recordingsDir = 'recordings', fetchFn: typeof fetch = fetch): Promise<boolean> {
  const say = (s = '') => console.log(s);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(recordingsDir, { recursive: true });

  const { rows: sample } = await db.query<{ manufacturer: string; category: string; mpn: string; upc: string | null; title: string }>(`
    SELECT manufacturer, category, mpn, upc, title FROM (
      SELECT m.manufacturer, m.category, m.mpn_raw AS mpn, m.upc, m.title,
             row_number() OVER (PARTITION BY m.manufacturer ORDER BY md5(m.mpn_normalized)) AS n
      FROM master_product m
      WHERE EXISTS (SELECT 1 FROM distributor_offer o WHERE o.master_product_id = m.id AND o.listed AND NOT o.discontinued)
    ) s WHERE n <= ${PER_MANUFACTURER} ORDER BY manufacturer, category`);
  if (!sample.length) {
    say('The catalog is empty. Run a full catalog pull first.');
    return false;
  }

  say(`Icecat check: looking up ${sample.length} of our products in Icecat's free catalog (user "${username}").`);
  say();
  // Icecat has used two spellings of its parameters; try the current one, fall back to the older one once.
  let style: 'new' | 'old' = 'new';
  const tally = new Map<string, Record<IcecatOutcome | 'images', number>>();
  for (const p of sample) {
    const t = tally.get(p.manufacturer) ?? { full: 0, basic: 0, 'paid-only': 0, 'not-found': 0, error: 0, images: 0 };
    tally.set(p.manufacturer, t);
    let best: IcecatSummary | null = null;
    for (const lookup of lookupsFor(p)) {
      let summary: IcecatSummary;
      let body: unknown;
      for (;;) {
        const url = new URL(API);
        const params = style === 'new' ? { UserName: username, Language: 'en', ...lookup } : { shopname: username, lang: 'en', ...lookup };
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        let status = 0;
        try {
          const res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
          status = res.status;
          const text = await res.text();
          try { body = JSON.parse(text); } catch { body = text; }
        } catch (err) {
          body = { Message: `Could not reach Icecat: ${(err as Error).message}` };
        }
        summary = summarizeIcecatReply(status, body);
        if (summary.outcome === 'error' && style === 'new' && /username|shopname|parameter/i.test(summary.message ?? '')) {
          style = 'old';
          continue;
        }
        break;
      }
      const file = `icecat-${stamp}-${p.manufacturer}-${(lookup.GTIN ?? lookup.ProductCode)!.replace(/[^\w-]/g, '_')}.json`;
      writeFileSync(join(recordingsDir, file), JSON.stringify({ lookup, body }, null, 2));
      if (!best || rank(summary) > rank(best)) best = summary;
      if (summary.outcome === 'full') break;
      await new Promise((r) => setTimeout(r, 500)); // be gentle: about 2 requests a second
    }
    t[best!.outcome]++;
    if (best!.images) t.images++;
    const mark = best!.outcome === 'full' ? '✔' : best!.outcome === 'basic' ? '~' : '✘';
    const what = best!.outcome === 'full' ? `${best!.features} specs, ${best!.images} images`
      : best!.outcome === 'basic' ? 'found, but only basic data (no specs)'
      : best!.outcome === 'paid-only' ? `only in paid Full Icecat${best!.message ? ` (Icecat: ${best!.message})` : ''}`
      : best!.outcome === 'not-found' ? 'not in Icecat'
      : `error: ${best!.message}`;
    say(`  ${mark} ${p.manufacturer.padEnd(7)} ${p.category.padEnd(17)} ${p.mpn.padEnd(16)} ${what}`);
  }

  say();
  say('Summary (products with full specs / found with basic data only / paid Full Icecat only / not in Icecat / with images):');
  let full = 0;
  for (const [m, t] of tally) {
    const n = t.full + t.basic + t['paid-only'] + t['not-found'] + t.error;
    full += t.full;
    say(`  ${m.padEnd(8)} ${t.full} of ${n} full · ${t.basic} basic · ${t['paid-only']} paid only · ${t['not-found']} not found · ${t.images} with images${t.error ? ` · ${t.error} errors` : ''}`);
  }
  say();
  say(`Raw Icecat replies saved in ${recordingsDir}/ (files starting "icecat-").`);
  return full > 0;
}

function rank(s: IcecatSummary): number {
  return { full: 4, basic: 3, 'paid-only': 2, 'not-found': 1, error: 0 }[s.outcome];
}
