// Saf istatistik yardımcıları (docs/08-V030-ANALYSIS.md §4.2). I/O, saat ve ortam yok.

/** Sıralı diziden R tip 7 (Excel PERCENTILE.INC) doğrusal enterpolasyonlu yüzdelik; p ∈ [0, 1]. */
export function quantile7(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('quantile7: boş dizi');
  if (!(p >= 0 && p <= 1)) throw new Error('quantile7: p 0 ile 1 arasında olmalı');
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return lo === hi ? a : a + (h - lo) * (b - a);
}

const ascending = (values: readonly number[]): number[] => values.slice().sort((a, b) => a - b);

export function median(values: readonly number[]): number {
  return quantile7(ascending(values), 0.5);
}

export interface Distribution {
  n: number;
  min: number;
  p10: number | null;
  q1: number | null;
  median: number;
  q3: number | null;
  p90: number | null;
  max: number;
  /** (q3 − q1) / median × 100 */
  iqrPct: number | null;
}

/** n < 5 iken yalnızca n, min, median, max dolu; diğerleri null. Boş dizi hata verir. */
export function describe(values: readonly number[]): Distribution {
  const s = ascending(values);
  if (s.length === 0) throw new Error('describe: boş dizi');
  const med = quantile7(s, 0.5);
  const base = { n: s.length, min: s[0]!, median: med, max: s[s.length - 1]! };
  if (s.length < 5) return { ...base, p10: null, q1: null, q3: null, p90: null, iqrPct: null };
  const q1 = quantile7(s, 0.25);
  const q3 = quantile7(s, 0.75);
  return {
    ...base,
    p10: quantile7(s, 0.1),
    q1,
    q3,
    p90: quantile7(s, 0.9),
    iqrPct: med > 0 ? ((q3 - q1) / med) * 100 : null,
  };
}

/** Orta-sıra yüzdeliği: (x'ten küçükler + 0,5 · eşitler) / n × 100. Boş dizi hata verir. */
export function midrankPercentile(values: readonly number[], x: number): number {
  if (values.length === 0) throw new Error('midrankPercentile: boş dizi');
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return ((below + 0.5 * equal) / values.length) * 100;
}

export type Point = readonly [x: number, y: number];

/** Tüm çiftlerin eğimleri; |Δx| < minAbsDx (ve her zaman Δx = 0) olan çiftler atlanır. */
export function pairwiseSlopes(points: readonly Point[], minAbsDx = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i]![0] - points[j]![0];
      if (dx === 0 || Math.abs(dx) < minAbsDx) continue;
      out.push((points[i]![1] - points[j]![1]) / dx);
    }
  }
  return out;
}

/** Theil–Sen eğimi (çift eğimlerinin medyanı); kullanılabilir çift yoksa null. */
export function theilSen(points: readonly Point[], minAbsDx = 0): { slope: number; pairs: number } | null {
  const s = pairwiseSlopes(points, minAbsDx);
  return s.length === 0 ? null : { slope: median(s), pairs: s.length };
}

/** Tukey çitleri: [Q1 − k·IQR, Q3 + k·IQR] (varsayılan k = 3, "uç" aykırı). En az 1 değer gerekir. */
export function tukeyFences(values: readonly number[], k = 3): { lo: number; hi: number; q1: number; q3: number } {
  const s = ascending(values);
  const q1 = quantile7(s, 0.25);
  const q3 = quantile7(s, 0.75);
  const iqr = q3 - q1;
  return { lo: q1 - k * iqr, hi: q3 + k * iqr, q1, q3 };
}
