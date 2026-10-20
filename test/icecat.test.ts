import { describe, expect, it } from 'vitest';
import { lookupsFor, summarizeIcecatReply } from '../src/icecat/check.js';

// Reply shapes follow Icecat's live JSON API as documented (GeneralInfo / FeaturesGroups / Gallery);
// replace with recorded replies once the first real check has run.
const full = {
  msg: 'OK',
  data: {
    GeneralInfo: { Title: 'HP EliteBook 840 G10 Intel Core i5 i5-1335U Laptop 35.6 cm (14")' },
    FeaturesGroups: [
      { FeatureGroup: { Name: { Value: 'Processor' } }, Features: [{ Feature: { Name: { Value: 'Processor family' } }, PresentationValue: 'Intel Core i5' }] },
      { FeatureGroup: { Name: { Value: 'Memory' } }, Features: [{ Feature: { Name: { Value: 'Internal memory' } }, PresentationValue: '16 GB' }] },
    ],
    Gallery: [{ Pic: 'https://images.icecat.biz/img/a.jpg' }, { Pic: 'https://images.icecat.biz/img/b.jpg' }],
  },
};

describe('Icecat replies', () => {
  it('counts specs and images in a full data-sheet', () => {
    expect(summarizeIcecatReply(200, full)).toMatchObject({ outcome: 'full', features: 2, images: 2 });
  });
  it('tells a basic entry (no specs) from a full one', () => {
    expect(summarizeIcecatReply(200, { data: { GeneralInfo: { Title: 'X' }, FeaturesGroups: [] } }).outcome).toBe('basic');
  });
  it('recognises "only in paid Full Icecat" and "not found"', () => {
    expect(summarizeIcecatReply(403, { Message: 'You are not allowed to have Full Icecat access' }).outcome).toBe('paid-only');
    expect(summarizeIcecatReply(404, { Message: 'The requested product is not present in the Icecat database' }).outcome).toBe('not-found');
    expect(summarizeIcecatReply(500, 'oops')).toMatchObject({ outcome: 'error', message: 'HTTP 500' });
  });
  it('tries the barcode, the part number, then the part number without its region code', () => {
    expect(lookupsFor({ manufacturer: 'HP', mpn: '8A3B4UT#ABC', upc: '196068000001' })).toEqual([
      { GTIN: '196068000001' }, { Brand: 'HP', ProductCode: '8A3B4UT#ABC' }, { Brand: 'HP', ProductCode: '8A3B4UT' },
    ]);
    expect(lookupsFor({ manufacturer: 'Lenovo', mpn: '21HD003BUS', upc: null })).toEqual([{ Brand: 'Lenovo', ProductCode: '21HD003BUS' }]);
  });
});
