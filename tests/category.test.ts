import { describe, expect, it } from 'vitest';
import { categoryMatches } from '../src/analytics/category.js';
import { listing, ob, searchInfo, summary } from './helpers/views.js';
import type { RecordView } from '../src/store/schema.js';

const CAT = 'opel-astra-1.3-cdti';
const detail: RecordView = {
  id: '1', full: true, observations: [],
  best: listing('1', { brand: 'Opel', series: 'Astra', model: '1.3 CDTI Enjoy' }),
};

describe('categoryMatches', () => {
  it('arama gözleminden eşleşir', () => {
    const v: RecordView = { id: '1', full: false, observations: [ob(1, '2026-11-01', { searchKey: 'k1' })], best: summary('1') };
    expect(categoryMatches(v, { k1: searchInfo({ category: CAT }) }, CAT)).toBe(true);
    expect(categoryMatches(v, { k1: searchInfo({ category: 'opel-corsa' }) }, CAT)).toBe(false);
    expect(categoryMatches(v, {}, CAT)).toBe(false);
  });

  it('detaydan Opel/Astra/1.3 CDTI Enjoy eşleşir; başka model ve motor eşleşmez', () => {
    expect(categoryMatches(detail, {}, CAT)).toBe(true);
    expect(categoryMatches(detail, {}, 'opel-corsa-1.3-cdti')).toBe(false);
    expect(categoryMatches(detail, {}, 'opel-astra-1.6')).toBe(false);
  });

  it('yalnızca marka+seri kategorisi tüm motorları kapsar; sınır "-" ile', () => {
    expect(categoryMatches(detail, {}, 'opel-astra')).toBe(true);
    expect(categoryMatches(detail, {}, 'opel-ast')).toBe(false);
    expect(categoryMatches({ ...detail, best: listing('1', { brand: 'Opel', series: 'Astra', model: '1.35 Enjoy' }) }, {}, 'opel-astra-1.3')).toBe(false);
  });

  it('marka/seri/model eksikse detaydan eşleşmez', () => {
    expect(categoryMatches({ ...detail, best: listing('1', { brand: null, series: 'Astra', model: '1.3 CDTI' }) }, {}, CAT)).toBe(false);
    expect(categoryMatches({ ...detail, best: listing('1', { brand: 'Opel', series: 'Astra', model: null }) }, {}, CAT)).toBe(false);
  });
});
