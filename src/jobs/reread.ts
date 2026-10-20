import type { Db } from '../db/pool.js';
import type { Country } from '../domain/types.js';
import { warehouseCountry } from '../domain/warehouse.js';
import { parseDetails, parseSpecs } from '../ingram/parse.js';

/**
 * Re-reads what's already stored, so a fix to how responses are read applies to existing products
 * without pulling everything from Ingram again (that's why raw responses are kept). Runs at start-up
 * and before each update; quick, and changes nothing that's already right.
 */
export async function rereadStoredData(db: Db, warehouseCountries: Record<string, Country>): Promise<{ warehouses: number; specs: number }> {
  // Which country each warehouse is in.
  let warehouses = 0;
  const { rows: places } = await db.query<{ warehouse_id: string; location: string | null; country: string | null }>(
    `SELECT DISTINCT warehouse_id, location, country FROM offer_stock`,
  );
  for (const p of places) {
    const country = warehouseCountry(p.warehouse_id, p.location, warehouseCountries);
    if (country === p.country) continue;
    const r = await db.query(
      `UPDATE offer_stock SET country = $3 WHERE warehouse_id = $1 AND location IS NOT DISTINCT FROM $2 AND country IS NOT DISTINCT FROM $4`,
      [p.warehouse_id, p.location, country, p.country],
    );
    warehouses += r.rowCount ?? 0;
  }

  // Specifications and long descriptions for products that have none yet.
  let specs = 0;
  const { rows } = await db.query<{ master_id: number; raw_details: unknown; raw_price_stock: unknown; has_description: boolean }>(
    `SELECT m.id AS master_id, o.raw_details, o.raw_price_stock, m.description IS NOT NULL AS has_description
     FROM distributor_offer o JOIN master_product m ON m.id = o.master_product_id
     WHERE o.distributor = 'ingram' AND m.specs = '{}'::jsonb AND (o.raw_details IS NOT NULL OR o.raw_price_stock IS NOT NULL)`,
  );
  for (const r of rows) {
    const details = r.raw_details ? parseDetails(r.raw_details) : null;
    const found = details && Object.keys(details.specs).length ? details.specs : parseSpecs(r.raw_price_stock);
    const description = !r.has_description ? details?.longDescription ?? null : null;
    if (!Object.keys(found).length && !description) continue;
    await db.query(
      `UPDATE master_product SET specs = CASE WHEN $2::jsonb <> '{}'::jsonb THEN $2::jsonb ELSE specs END,
         description = COALESCE(description, $3), updated_at = now() WHERE id = $1`,
      [r.master_id, JSON.stringify(found), description],
    );
    if (Object.keys(found).length) specs++;
  }
  return { warehouses, specs };
}
