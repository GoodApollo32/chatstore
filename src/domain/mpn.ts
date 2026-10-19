// MPN comparison key. The raw value is always kept; this key is only for matching.
// Region codes such as HP "#ABC" stay in the key on purpose (ADR 0001): they decide keyboard
// layout and power cord, so "#ABC" and "#ABA" must never collide.

export function normalizeMpn(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const key = raw.toUpperCase().replace(/[\s\-.]/g, '');
  return key === '' ? null : key;
}

/** UPC/EAN as digits only, with leading zeros dropped so 12- and 13-digit forms compare equal. */
export function normalizeUpc(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 6 ? digits : null;
}
