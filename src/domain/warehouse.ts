import type { Country } from './types.js';

const PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
const PROVINCE_NAMES = /\b(ALBERTA|BRITISH COLUMBIA|MANITOBA|NEW BRUNSWICK|NEWFOUNDLAND|NOVA SCOTIA|ONTARIO|QUEBEC|QU[ÉE]BEC|SASKATCHEWAN|CANADA)\b/;
const STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

// Ingram Canada's warehouses may be reported by city alone ("Mississauga"), so known Canadian
// distribution cities count too.
const CANADIAN_CITIES = /\b(MISSISSAUGA|TORONTO|BRAMPTON|MILTON|VAUGHAN|MARKHAM|OAKVILLE|BOLTON|OTTAWA|VANCOUVER|DELTA|BURNABY|SURREY|LANGLEY|COQUITLAM|MONTR[EÉ]AL|DORVAL|LAVAL|POINTE-CLAIRE|CALGARY|EDMONTON|WINNIPEG|REGINA|SASKATOON|HALIFAX|DARTMOUTH|MONCTON)\b/;

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
  const canadianCity = CANADIAN_CITIES.test(upper);
  // "Mississauga ON" / "Vancouver BC V6B 1A1": without a comma only a province code is trusted
  // (a trailing "DC" could just as well be "distribution centre").
  const bareProvince = upper.match(/\s([A-Z]{2})(?:\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?\s*$/)?.[1];
  if (bareProvince && PROVINCES.has(bareProvince)) return 'CA';
  // "Mississauga, ON", "MISSISSAUGA,ON L5T 2V8", "Mira Loma, CA"
  const code = upper.match(/,\s*([A-Z]{2})\b/)?.[1];
  if (code) {
    if (PROVINCES.has(code)) return 'CA';
    // "Mississauga, CA" is Canada; "Mira Loma, CA" is California.
    if (code === 'CA' && canadianCity) return 'CA';
    if (STATES.has(code)) return 'US';
  }
  return canadianCity ? 'CA' : null;
}
