import { describe as suite, expect, it } from 'vitest';
import { describe, median, midrankPercentile, pairwiseSlopes, quantile7, theilSen, tukeyFences } from '../src/analytics/stats.js';
import { lcg } from './helpers/synthetic-market.js';

suite('quantile7', () => {
  it('[1,2,3,4]: Excel PERCENTILE.INC ile aynı', () => {
    const s = [1, 2, 3, 4];
    expect(quantile7(s, 0.25)).toBeCloseTo(1.75, 10);
    expect(quantile7(s, 0.5)).toBeCloseTo(2.5, 10);
    expect(quantile7(s, 0.9)).toBeCloseTo(3.7, 10);
    expect(quantile7(s, 0)).toBe(1);
    expect(quantile7(s, 1)).toBe(4);
  });
  it('tek eleman her yüzdelikte kendisi; boş dizi ve geçersiz p hata', () => {
    expect(quantile7([42], 0.9)).toBe(42);
    expect(() => quantile7([], 0.5)).toThrow();
    expect(() => quantile7([1], 1.2)).toThrow();
  });
  it('median girdiyi değiştirmez ve sırasız girdiyi kabul eder', () => {
    const v = [5, 1, 3];
    expect(median(v)).toBe(3);
    expect(v).toEqual([5, 1, 3]);
  });
});

suite('describe', () => {
  it('n >= 5: tüm alanlar, iqrPct', () => {
    const d = describe([100, 110, 120, 130, 140, 150, 160, 170, 180, 190]);
    expect(d).toMatchObject({ n: 10, min: 100, median: 145, max: 190 });
    expect(d.q1).toBeCloseTo(122.5, 10);
    expect(d.q3).toBeCloseTo(167.5, 10);
    expect(d.p10).toBeCloseTo(109, 10);
    expect(d.p90).toBeCloseTo(181, 10);
    expect(d.iqrPct).toBeCloseTo((45 / 145) * 100, 8);
  });
  it('n < 5: yalnızca n, min, median, max', () => {
    expect(describe([3, 1, 2])).toEqual({ n: 3, min: 1, median: 2, max: 3, p10: null, q1: null, q3: null, p90: null, iqrPct: null });
    expect(describe([7])).toMatchObject({ n: 1, min: 7, median: 7, max: 7, q1: null });
  });
  it('boş dizi hata verir', () => {
    expect(() => describe([])).toThrow();
  });
});

suite('midrankPercentile', () => {
  it('eşit değerler yarım sayılır', () => {
    expect(midrankPercentile([1, 2, 2, 3], 2)).toBe(50);
    expect(midrankPercentile([1, 2, 3, 4], 0)).toBe(0);
    expect(midrankPercentile([1, 2, 3, 4], 10)).toBe(100);
    expect(midrankPercentile([5, 5, 5, 5], 5)).toBe(50);
  });
  it('boş dizi hata', () => {
    expect(() => midrankPercentile([], 1)).toThrow();
  });
});

suite('theilSen', () => {
  it('doğrusal veride tam eğim', () => {
    const pts = [0, 1, 2, 3, 4, 5].map((x) => [x, 2 * x + 1] as const);
    expect(theilSen(pts)?.slope).toBeCloseTo(2, 12);
    expect(theilSen(pts)?.pairs).toBe(15);
  });
  it('%20 aykırı değerde eğim ±%5 içinde kalır', () => {
    const rnd = lcg(3);
    const pts: Array<readonly [number, number]> = [];
    for (let i = 0; i < 50; i++) pts.push([i, 3 * i + 10]);
    for (let i = 0; i < 50; i += 5) pts[i] = [i, 3 * i + 10 + (rnd() < 0.5 ? 500 : -500)]; // 10 aykırı = %20
    const slope = theilSen(pts)!.slope;
    expect(Math.abs(slope - 3) / 3).toBeLessThan(0.05);
  });
  it('Δx = 0 ve minAbsDx altındaki çiftler atlanır; çift yoksa null', () => {
    expect(theilSen([[1, 1], [1, 5]])).toBeNull();
    expect(pairwiseSlopes([[0, 0], [5, 10], [20, 40]], 10)).toEqual([2, 2]);
    expect(theilSen([])).toBeNull();
  });
});

suite('tukeyFences', () => {
  it('k=3 çitleri', () => {
    const f = tukeyFences([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(f.q1).toBe(3);
    expect(f.q3).toBe(7);
    expect(f.lo).toBe(3 - 12);
    expect(f.hi).toBe(7 + 12);
  });
});
