import type { Country } from './types.js';

const PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
const PROVINCE_NAMES = /\b(ALBERTA|BRITISH COLUMBIA|MANITOBA|NEW BRUNSWICK|NEWFOUNDLAND|NOVA SCOTIA|ONTARIO|QUEBEC|QU[ÉE]BEC|SASKATCHEWAN|CANADA)\b/;
const STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

/**
 * Works out whether a warehouse is Canadian or American. Ingram reports a location such as
 * "Mississauga, ON" but no country, so the province/state code decides. `overrides` (from
 * config/scope.json, keyed by warehouse ID) wins over the guess once real codes are known.
 * Returns null when it can't tell; unknown warehouses never count as In Stock.
 */
export function warehouseCountry(
  warehouseId: string,
  location: string | null,
  overrides: Record<string, Country> = {},
): Country | null {
  const override = overrides[warehouseId];
  if (override) return override;
  if (!location) return null;
  const upper = location.toUpperCase();
  if (PROVINCE_NAMES.test(upper)) return 'CA';
  const code = upper.match(/,\s*([A-Z]{2})\b/)?.[1];
  if (!code) return null;
  if (PROVINCES.has(code)) return 'CA';
  if (STATES.has(code)) return 'US';
  return null;
}
