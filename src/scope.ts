import { readFileSync } from 'node:fs';
import type { Country } from './domain/types.js';

export interface ManufacturerScope {
  name: string;
  ingramSearch: string;
  namesUsedByDistributors: string[];
}

interface RuleSpec {
  /** Outcome: one of our categories ... */
  putIn?: string;
  /** ... or a reason for leaving the product out. */
  exclude?: string;
  // Tests, matched case-insensitively; every test given must pass.
  distributorCategory?: string;
  distributorSubCategory?: string;
  description?: string;
  notDescription?: string;
  /** Our Manufacturer name (exact, e.g. "Lenovo"). */
  manufacturer?: string;
  /** Manufacturer part number pattern, e.g. "CA$" for part numbers ending in CA. */
  mpn?: string;
  /**
   * Exclude rules only: applies to products already sorted into one of these of our categories.
   * Checked after the category is decided, so it can't be pre-empted by a putIn rule.
   */
  ourCategory?: string[];
}

type Field = 'category' | 'subCategory' | 'description' | 'manufacturer' | 'mpn';

interface CompiledRule {
  outcome: Classification;
  tests: { field: Field; re: RegExp; negate: boolean }[];
  ourCategory: string[] | null;
}

export interface ClassifyInput {
  category: string | null;
  subCategory: string | null;
  description: string;
  /** Our Manufacturer name. */
  manufacturer?: string | null;
  mpn?: string | null;
}

export type Classification =
  | { inScope: true; category: string }
  | { inScope: false; reason: string };

export const NOT_IN_SCOPE = 'Not in version-one categories';

export interface Scope {
  manufacturers: ManufacturerScope[];
  categories: string[];
  warehouseCountries: Record<string, Country>;
  fetchProductDetails: boolean;
  /** Our Manufacturer name for a distributor's manufacturer name, or null if unrecognized. */
  manufacturerFor(distributorName: string): string | null;
  classify(p: ClassifyInput): Classification;
}

export function loadScope(path: string): Scope {
  return parseScope(JSON.parse(readFileSync(path, 'utf8')));
}

export function parseScope(json: any): Scope {
  const manufacturers: ManufacturerScope[] = json.manufacturers ?? [];
  const categories: string[] = json.categories ?? [];
  if (manufacturers.length === 0) throw new Error('Scope has no manufacturers');

  const byName = new Map<string, string>();
  for (const m of manufacturers) {
    byName.set(m.name.toUpperCase(), m.name);
    for (const alias of m.namesUsedByDistributors ?? []) byName.set(alias.trim().toUpperCase(), m.name);
  }

  const rules: CompiledRule[] = (json.rules as RuleSpec[]).map((r, i) => {
    if (!r.putIn === !r.exclude) throw new Error(`Rule ${i + 1} needs exactly one of "putIn" or "exclude"`);
    if (r.putIn && !categories.includes(r.putIn)) {
      throw new Error(`Rule ${i + 1} puts products in "${r.putIn}", which isn't in the categories list`);
    }
    if (r.ourCategory) {
      if (r.putIn) throw new Error(`Rule ${i + 1}: "ourCategory" only works with "exclude"`);
      for (const c of r.ourCategory) if (!categories.includes(c)) throw new Error(`Rule ${i + 1}: "${c}" isn't in the categories list`);
    }
    if (r.manufacturer && !manufacturers.some((m) => m.name === r.manufacturer)) {
      throw new Error(`Rule ${i + 1}: manufacturer "${r.manufacturer}" isn't in the manufacturers list`);
    }
    const tests: CompiledRule['tests'] = [];
    const add = (field: Field, pattern: string | undefined, negate = false) => {
      if (pattern) tests.push({ field, re: new RegExp(pattern, 'i'), negate });
    };
    add('category', r.distributorCategory);
    add('subCategory', r.distributorSubCategory);
    add('description', r.description);
    add('description', r.notDescription, true);
    if (r.manufacturer) add('manufacturer', `^${r.manufacturer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    add('mpn', r.mpn);
    if (tests.length === 0) throw new Error(`Rule ${i + 1} has nothing to match on`);
    return {
      outcome: r.putIn ? { inScope: true, category: r.putIn } : { inScope: false, reason: r.exclude! },
      tests,
      ourCategory: r.ourCategory ?? null,
    };
  });

  const warehouseCountries: Record<string, Country> = {};
  for (const [id, country] of Object.entries(json.warehouseCountries ?? {})) {
    if (id.startsWith('_')) continue;
    if (country !== 'CA' && country !== 'US') throw new Error(`Warehouse ${id}: country must be "CA" or "US"`);
    warehouseCountries[id] = country;
  }

  return {
    manufacturers,
    categories,
    warehouseCountries,
    fetchProductDetails: json.fetchProductDetails !== false,
    manufacturerFor: (name) => byName.get(name.trim().toUpperCase()) ?? null,
    classify(p) {
      const values: Record<Field, string> = {
        category: p.category ?? '', subCategory: p.subCategory ?? '', description: p.description,
        manufacturer: p.manufacturer ?? '', mpn: p.mpn ?? '',
      };
      const matches = (rule: CompiledRule) => rule.tests.every((t) => t.re.test(values[t.field]) !== t.negate);
      let outcome: Classification = { inScope: false, reason: NOT_IN_SCOPE };
      for (const rule of rules) {
        if (!rule.ourCategory && matches(rule)) {
          outcome = rule.outcome;
          break;
        }
      }
      if (!outcome.inScope) return outcome;
      const category = outcome.category;
      return rules.find((r) => r.ourCategory?.includes(category) && matches(r))?.outcome ?? outcome;
    },
  };
}
