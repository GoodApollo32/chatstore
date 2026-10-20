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

  it('copes with the ways Ingram Canada may write a Canadian location', () => {
    expect(warehouseCountry('40', 'Mississauga')).toBe('CA');
    expect(warehouseCountry('40', 'MISSISSAUGA ON')).toBe('CA');
    expect(warehouseCountry('40', 'Mississauga, CA')).toBe('CA');
    expect(warehouseCountry('40', 'MISSISSAUGA,ON L5T 2V8')).toBe('CA');
    expect(warehouseCountry('41', 'Vancouver BC V6B 1A1')).toBe('CA');
    expect(warehouseCountry('42', 'Montréal')).toBe('CA');
    expect(warehouseCountry('43', 'Ingram Micro Canada')).toBe('CA');
  });

  it('a state code wins over a city name that exists in both countries', () => {
    expect(warehouseCountry('20', 'Delta, OH')).toBe('US');
    expect(warehouseCountry('20', 'Carol Stream, IL')).toBe('US');
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
