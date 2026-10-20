import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDetails, parsePriceAndAvailability, parseSearchPage, parseSpecs } from '../src/ingram/parse.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/ingram-spec/${name}`, import.meta.url), 'utf8'));

describe('catalog search', () => {
  const page = parseSearchPage(fixture('search.json'), 2, 25);

  it('maps a listing to the normalized shape', () => {
    expect(page.listings).toHaveLength(1);
    const l = page.listings[0]!;
    expect(l).toMatchObject({
      distributor: 'ingram',
      distributorSku: '1A8249',
      mpnRaw: 'SDSQUNC-016G-AN6IA',
      upc: '0619659134587',
      manufacturerRaw: 'Sandisk Mobile',
      distributorCategory: 'device storage',
      distributorSubcategory: 'Flash Memory Devices',
      discontinued: false,
      authorizedToPurchase: true,
    });
    // description and extraDescription are combined and tidied
    expect(l.title).toBe('CLASS 10 100MB/S UHS-I CARD IPAD AIR CELL 256GB SKY BLUE');
  });

  it('keeps the raw payload', () => {
    expect((page.listings[0]!.raw as any).ingramPartNumber).toBe('1A8249');
  });

  it('knows when there are more pages', () => {
    expect(page.totalRecords).toBe(1180);
    // The example page holds 1 item but claims a page size of 25, so it reads as the last page.
    expect(page.isLastPage).toBe(true);
    const full = parseSearchPage({ ...fixture('search.json'), catalog: Array(25).fill(fixture('search.json').catalog[0]) }, 2, 25);
    expect(full.isLastPage).toBe(false);
  });

  it('copes with an empty page', () => {
    expect(parseSearchPage({ recordsFound: 0 }, 1, 100)).toMatchObject({ listings: [], isLastPage: true });
  });
});

describe('price & availability', () => {
  it('reads cost, MSRP, currency and stock by warehouse', () => {
    const [r] = parsePriceAndAvailability(fixture('price-and-availability-200.json'));
    if (!r?.ok) throw new Error('expected success');
    expect(r).toMatchObject({ distributorSku: '4A0036', cost: 74.34, msrp: 189.99, mapPrice: 0, currency: 'USD' });
    expect(r.stock.map((w) => [w.warehouseId, w.country])).toEqual([['20', 'US'], ['40', 'US'], ['80', 'US'], ['10', 'US']]);
    expect(r.stock[0]!.backorderEtas).toEqual([{ quantity: 1437, etaDate: '2025-01-01' }, { quantity: 8163, etaDate: '2026-01-01' }]);
    expect(r.stock[1]!.quantityBackordered).toBe(156);
  });

  it('keeps special pricing for reference and drops placeholder quantity breaks', () => {
    const [r] = parsePriceAndAvailability(fixture('price-and-availability-200.json'));
    if (!r?.ok) throw new Error('expected success');
    expect(r.quantityBreaks).toEqual([]);
    expect(r.specialPricing).toHaveLength(2);
    expect(r.specialPricing[0]).toMatchObject({ type: 'Special Bid', bidNumber: 'TESTRKP1', discount: 6.74 });
  });

  it('handles a partial success (HTTP 207): one product priced, one not found', () => {
    const results = parsePriceAndAvailability(fixture('price-and-availability-207.json'));
    expect(results).toHaveLength(2);
    const [good, bad] = results;
    expect(good).toMatchObject({ ok: true, distributorSku: '123512', cost: 5.43, msrp: 10, currency: 'USD' });
    expect(bad).toMatchObject({ ok: false, distributorSku: '12351211' });
    if (good?.ok) {
      // A warehouse with no location can't be placed in a country.
      expect(good.stock.find((w) => w.warehouseId === '25')).toMatchObject({ quantityAvailable: 100000, country: null });
    }
  });

  it('picks out EHF from service fees and keeps it separate from cost', () => {
    const [r] = parsePriceAndAvailability([
      {
        ingramPartNumber: 'ABC123',
        pricing: { customerPrice: 1000, retailPrice: 1400, currencyCode: 'CAD' },
        serviceFees: [
          { conditionType: 'ZEHF', description: 'BC EHF - Notebooks', amount: '1.75', currencyCode: 'CAD' },
          { conditionType: 'ZFRT', description: 'Freight surcharge', amount: 5, currencyCode: 'CAD' },
        ],
        discounts: [{ quantityDiscounts: [{ quantity: 10, amount: 980, currencyCode: 'CAD' }, { quantity: 5, amount: 990, currencyCode: 'CAD' }] }],
      },
    ]);
    if (!r?.ok) throw new Error('expected success');
    expect(r.cost).toBe(1000);
    expect(r.ehf).toBe(1.75);
    expect(r.fees.map((f) => f.isEhf)).toEqual([true, false]);
    expect(r.quantityBreaks.map((b) => b.minQuantity)).toEqual([5, 10]);
  });

  it('reports no EHF as null, not zero', () => {
    const [r] = parsePriceAndAvailability([{ ingramPartNumber: 'X', pricing: { customerPrice: 1 } }]);
    expect(r).toMatchObject({ ok: true, ehf: null });
  });
});

describe('product details', () => {
  it('reads specs, long description and the refurbished flag', () => {
    const d = parseDetails(fixture('details.json'));
    expect(d.distributorSku).toBe('5348387');
    expect(d.specs['Operating System']).toBe('Windows 11 Pro');
    expect(d.longDescription).toMatch(/^Lenovo ThinkBook 15 G2/);
    expect(d.isRefurbished).toBe(false);
    expect(d.imageUrls).toEqual([]);
  });
});

describe('specifications in other layouts', () => {
  it('reads name/value pairs under any spelling and grouping', () => {
    expect(parseSpecs({ technicalSpecifications: [{ HeaderName: 'Basic', AttributeName: 'RAM', AttributeValue: '16 GB' }] })).toEqual({ RAM: '16 GB' });
    expect(parseSpecs({ specifications: [{ groupName: 'Display', attributes: [{ name: 'Screen Size', value: '14"' }] }] })).toEqual({ 'Screen Size': '14"' });
    expect(parseSpecs({ productAttributes: [{ attribute_name: 'Ports', attribute_values: ['USB-C', 'HDMI'] }] })).toEqual({ Ports: 'USB-C, HDMI' });
  });

  it('does not mistake fees or prices for specifications', () => {
    expect(parseSpecs({ serviceFees: [{ name: 'EHF', value: '1.75' }], pricing: { name: 'x', value: '1' } })).toEqual({});
  });

  it('reads product details wrapped in a list', () => {
    const d = parseDetails([{ ingramPartNumber: 'X1', technicalSpecifications: [{ attributename: 'CPU', attributevalue: 'i5' }] }]);
    expect(d.distributorSku).toBe('X1');
    expect(d.specs).toEqual({ CPU: 'i5' });
  });
});

describe('real Ingram Canada product details', () => {
  it('has no specifications or long description (open question Q2), but reads the rest', () => {
    const d = parseDetails(JSON.parse(readFileSync(new URL('./fixtures/ingram-ca/details-production.json', import.meta.url), 'utf8')));
    expect(d.distributorSku).toBe('FL4752');
    expect(d.specs).toEqual({});
    expect(d.longDescription).toBeNull();
    expect(d.isRefurbished).toBe(false);
  });
});
