import { describe, expect, it } from 'vitest';
import { normalizeMpn, normalizeUpc } from '../src/domain/mpn.js';

describe('normalizeMpn', () => {
  it('uppercases and strips spaces, dashes and dots', () => {
    expect(normalizeMpn(' 20ve-0117.mh ')).toBe('20VE0117MH');
    expect(normalizeMpn('SDSQUNC-016G-AN6IA')).toBe('SDSQUNC016GAN6IA');
  });

  it('keeps HP region codes so Canadian and US variants stay separate (ADR 0001)', () => {
    const ca = normalizeMpn('8A3B4UT#ABC');
    const us = normalizeMpn('8A3B4UT#ABA');
    expect(ca).toBe('8A3B4UT#ABC');
    expect(ca).not.toBe(us);
  });

  it('treats blank as missing', () => {
    expect(normalizeMpn('')).toBeNull();
    expect(normalizeMpn(' - ')).toBeNull();
    expect(normalizeMpn(null)).toBeNull();
  });
});

describe('normalizeUpc', () => {
  it('compares 12- and 13-digit forms equally', () => {
    expect(normalizeUpc('0884116186519')).toBe(normalizeUpc('884116186519'));
  });
  it('ignores junk', () => {
    expect(normalizeUpc('n/a')).toBeNull();
  });
});
