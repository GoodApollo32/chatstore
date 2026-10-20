import { describe, expect, it } from 'vitest';
import { loadScope, NOT_IN_SCOPE, parseScope } from '../src/scope.js';

const scope = loadScope('config/scope.json');
const classify = (subCategory: string, description = 'PRODUCT', category = 'Computers') =>
  scope.classify({ category, subCategory, description });

describe('scope: manufacturers', () => {
  it('recognises the names distributors use', () => {
    expect(scope.manufacturerFor('LENOVO')).toBe('Lenovo');
    expect(scope.manufacturerFor('hp inc')).toBe('HP');
    expect(scope.manufacturerFor('Dell')).toBe('Dell');
  });
  it('does not treat HP Enterprise as HP', () => {
    expect(scope.manufacturerFor('HEWLETT PACKARD ENTERPRISE')).toBeNull();
    expect(scope.manufacturerFor('HPE')).toBeNull();
  });
});

describe('scope: category rules (starting guesses)', () => {
  it('puts notebooks, 2-in-1s and chromebooks in Laptops', () => {
    expect(classify('Notebooks & Tablets', 'TB 15 G2 CI5-1135G7 8/256GB 15.6 W11P')).toEqual({ inScope: true, category: 'Laptops' });
    expect(classify('Chromebooks')).toEqual({ inScope: true, category: 'Laptops' });
    expect(classify('Mobile Workstations')).toEqual({ inScope: true, category: 'Laptops' });
  });

  it('excludes tablets but keeps 2-in-1s', () => {
    expect(classify('Notebooks & Tablets', 'LENOVO TAB M10 PLUS 128GB')).toEqual({ inScope: false, reason: 'Tablets' });
    expect(classify('Notebooks & Tablets', 'YOGA 7 2-IN-1 14IN TABLET MODE')).toEqual({ inScope: true, category: 'Laptops' });
    expect(classify('Tablets')).toEqual({ inScope: false, reason: 'Tablets' });
  });

  it('sorts desktops, all-in-ones, thin clients and monitors', () => {
    expect(classify('Desktops')).toEqual({ inScope: true, category: 'Desktops' });
    expect(classify('All-in-One Computers')).toEqual({ inScope: true, category: 'Desktops' });
    expect(classify('Thin Clients')).toEqual({ inScope: true, category: 'Desktops' });
    expect(classify('Monitors', 'P2425H 24IN', 'Displays')).toEqual({ inScope: true, category: 'Monitors' });
  });

  it('keeps docking stations even though they sit among accessories', () => {
    expect(classify('Docking Stations & Port Replicators')).toEqual({ inScope: true, category: 'Docking Stations' });
    expect(classify('Notebook Accessories', 'THINKPAD UNIVERSAL USB-C DOCK')).toEqual({ inScope: true, category: 'Docking Stations' });
  });

  it('leaves out parts, bags, warranties and refurbished units', () => {
    expect(classify('Notebook Batteries')).toEqual({ inScope: false, reason: 'Parts, bags and accessories' });
    expect(classify('Carrying Cases')).toEqual({ inScope: false, reason: 'Parts, bags and accessories' });
    expect(classify('Warranties', '3YR ONSITE', 'Services')).toEqual({ inScope: false, reason: 'Warranty and service add-ons' });
    expect(classify('Notebooks', 'REFURBISHED THINKPAD T14')).toEqual({ inScope: false, reason: 'Refurbished or open box' });
  });

  it('leaves out everything else as not in scope', () => {
    expect(classify('Printers', 'LASERJET', 'Printing')).toEqual({ inScope: false, reason: NOT_IN_SCOPE });
  });
});

describe('scope: validation', () => {
  const base = { manufacturers: [{ name: 'X', ingramSearch: 'X', namesUsedByDistributors: [] }], categories: ['Laptops'] };
  it('rejects a rule pointing at an unknown category', () => {
    expect(() => parseScope({ ...base, rules: [{ putIn: 'Phones', distributorSubCategory: 'PHONE' }] })).toThrow(/isn't in the categories list/);
  });
  it('rejects a rule with nothing to match on', () => {
    expect(() => parseScope({ ...base, rules: [{ putIn: 'Laptops' }] })).toThrow(/nothing to match/);
  });
  it('rejects a bad warehouse country', () => {
    expect(() => parseScope({ ...base, rules: [], warehouseCountries: { '10': 'MX' } })).toThrow(/CA" or "US/);
  });
});

describe('scope: French-Canadian Lenovo versions', () => {
  const lenovo = (subCategory: string, mpn: string, manufacturer = 'Lenovo') =>
    scope.classify({ category: 'Computers', subCategory, description: 'THINKPAD', manufacturer, mpn });

  it('leaves out Lenovo laptops and desktops whose part number ends in CA', () => {
    const reason = 'French-Canadian versions (Lenovo part numbers ending in CA)';
    expect(lenovo('Notebooks', '21HD003BCA')).toEqual({ inScope: false, reason });
    expect(lenovo('Desktops', '12E3000ACA')).toEqual({ inScope: false, reason });
  });

  it('keeps the English versions, other categories and other manufacturers', () => {
    expect(lenovo('Notebooks', '21HD003BUS')).toEqual({ inScope: true, category: 'Laptops' });
    expect(lenovo('Monitors', '63B4MAR6CA')).toEqual({ inScope: true, category: 'Monitors' });
    expect(lenovo('Notebooks', 'ABC123CA', 'HP')).toEqual({ inScope: true, category: 'Laptops' });
  });

  it('refuses a category rule that names an unknown category or manufacturer', () => {
    const base = { manufacturers: [{ name: 'Lenovo', ingramSearch: 'Lenovo', namesUsedByDistributors: [] }], categories: ['Laptops'] };
    expect(() => parseScope({ ...base, rules: [{ exclude: 'x', mpn: 'CA$', ourCategory: ['Tablets'] }] })).toThrow(/Tablets/);
    expect(() => parseScope({ ...base, rules: [{ exclude: 'x', mpn: 'CA$', manufacturer: 'Lenvo' }] })).toThrow(/Lenvo/);
    expect(() => parseScope({ ...base, rules: [{ putIn: 'Laptops', mpn: 'CA$', ourCategory: ['Laptops'] }] })).toThrow(/only works with "exclude"/);
  });
});
