import { describe, expect, it } from 'vitest';
import { warehouseCountry } from '../src/domain/warehouse.js';

describe('warehouseCountry', () => {
  it('reads the province or state code from the location', () => {
    expect(warehouseCountry('70', 'Mississauga, ON')).toBe('CA');
    expect(warehouseCountry('71', 'Richmond, BC')).toBe('CA');
    expect(warehouseCountry('20', 'Fort Worth, TX')).toBe('US');
  });

  it('treats ", CA" as California, not Canada', () => {
    expect(warehouseCountry('10', 'Mira Loma, CA')).toBe('US');
  });

  it('recognises province names', () => {
    expect(warehouseCountry('72', 'Vancouver, British Columbia')).toBe('CA');
  });

  it('returns null when it cannot tell, so the stock never counts as Canadian by accident', () => {
    expect(warehouseCountry('25', null)).toBeNull();
    expect(warehouseCountry('25', 'Main DC')).toBeNull();
  });

  it('lets the scope file override the guess', () => {
    expect(warehouseCountry('25', null, { '25': 'CA' })).toBe('CA');
    expect(warehouseCountry('10', 'Mira Loma, CA', { '10': 'CA' })).toBe('CA');
  });
});
