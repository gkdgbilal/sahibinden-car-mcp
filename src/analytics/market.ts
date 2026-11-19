import { evaluateQuery } from '../sahibinden/filter.js';
import { foldTr } from '../sahibinden/normalize.js';
import type { Listing, SearchQuery } from '../sahibinden/types.js';
import { observationTime } from '../store/schema.js';
import type { Observation, RecordView, SearchInfo } from '../store/schema.js';
import { categoryMatches } from './category.js';
import { DAY_MS } from './history.js';
import { describe, median, midrankPercentile, pairwiseSlopes, tukeyFences } from './stats.js';
import type { Distribution } from './stats.js';
import { slugify } from '../sahibinden/url-builder.js';

// Piyasa istatistiği (docs/08-V030-ANALYSIS.md §4). Saf: saat parametre, I/O ve ortam yok.

export type DamageGroup = 'clean' | 'painted' | 'replaced' | 'heavy' | 'unknown';
export type DamageEvidence = 'detail' | 'search-filter' | 'none';
export type Confidence = 'insufficient' | 'low' | 'medium' | 'high';
export type PositionBand = 'well-below' | 'below' | 'typical' | 'above' | 'well-above';
export type Basis = 'adjusted' | 'narrow-band' | 'raw-segment';

export const MIN_PLAUSIBLE_PRICE = 25_000;
const OUTLIER_MIN_N = 8;
const KM_PAIR_MIN_DELTA = 10_000;
const MIN_PAIRS = 10;
const MIN_FIT_N = 12;
const MIN_SHOWN_N = 5;
const WINDOW_ADJ = { years: 2, km: 60_000 };
const WINDOW_BAND = { years: 1, km: 30_000 };
const OLD_OBSERVATION_DAYS = 30;
const LOW_COVERAGE = 0.5;
/** Makul km eğimi: 10 bin km başına %0 ile %-4 arası. */
const KM_SLOPE_MIN = Math.log(0.96) / 10_000;
/** Makul yıl eğimi: model yılı başına %0 ile +%25 arası. */
const YEAR_SLOPE_MAX = Math.log(1.25);

export type MarketSegment = Partial<
  Pick<
    SearchQuery,
    | 'city' | 'brand' | 'models' | 'yearMin' | 'yearMax' | 'kmMin' | 'kmMax' | 'transmission' | 'fuel'
    | 'sellerType' | 'bodyType' | 'enginePower' | 'engineVolume'
  >
> & { category?: string };

export interface MarketTargetInput {
  ref?: string;
  year?: number;
  km?: number;
  price?: number;
  trim?: string;
  damage?: DamageGroup;
  tramerAmount?: number;
}

export interface MarketInput {
  segment?: MarketSegment;
  target?: MarketTargetInput;
  damagePolicy: 'match-target' | 'clean' | 'any';
  maxAgeDays: number;
  minSample: number;
  adjust: 'auto' | 'none';
  comparables: number;
}

export interface MarketOptions {
  /** Çağıranın `target.ref` için store'dan çözdüğü kayıt (saf modül store'a erişmez). */
  targetView?: RecordView;
}

// ---------- küçük yardımcılar ----------

const r0 = (x: number): number => Math.round(x);
const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const medOrNull = (v: readonly number[], minN = 3): number | null => (v.length >= minN ? r0(median(v)) : null);
const trNum = (x: number, digits = 1): string => x.toFixed(digits).replace('.', ',');
const fmtTl = (x: number): string => `${Math.round(x).toLocaleString('tr-TR')} TL`;

const latestAt = (obs: readonly Observation[]): number => {
  let t = Number.NEGATIVE_INFINITY;
  for (const o of obs) t = Math.max(t, observationTime(o.at));
  return t;
};

export const roundDist = (d: Distribution) => ({
  n: d.n,
  min: r0(d.min),
  p10: d.p10 === null ? null : r0(d.p10),
  q1: d.q1 === null ? null : r0(d.q1),
  median: r0(d.median),
  q3: d.q3 === null ? null : r0(d.q3),
  p90: d.p90 === null ? null : r0(d.p90),
  max: r0(d.max),
  iqrPct: d.iqrPct === null ? null : r1(d.iqrPct),
});

// ---------- hasar grubu (08 §4.3) ----------

function detailGroup(best: RecordView['best']): DamageGroup {
  const d = best as Partial<Listing>;
  if (d.heavyDamage === true) return 'heavy';
  const parts = d.damage && d.damage.length > 0 ? d.damage : null;
  if (!parts) return 'unknown';
  if (parts.some((p) => p.status === 'changed')) return 'replaced';
  if (parts.some((p) => p.status === 'painted' || p.status === 'local-painted')) return 'painted';
  return 'clean';
}

export interface DamageInfo {
  group: DamageGroup;
  evidence: DamageEvidence;
  /** Detay "hatasız değil" derken arama URL'si "hatasız" diyor (detay üstün gelir). */
  conflict: boolean;
}

/** Hasar grubu: detay her zaman arama kanıtına üstündür; çelişki işaretlenir. */
export function damageGroupOf(
  view: Pick<RecordView, 'best' | 'observations'>,
  now: Date,
  maxAgeDays: number,
): DamageInfo {
  const since = now.getTime() - maxAgeDays * DAY_MS;
  const searchClean = view.observations.some(
    (o) =>
      o.kind === 'search' &&
      observationTime(o.at) >= since &&
      (o.filters ?? []).includes('unpainted') &&
      (o.filters ?? []).includes('noReplaced'),
  );
  const detail = detailGroup(view.best);
  if (detail !== 'unknown') return { group: detail, evidence: 'detail', conflict: searchClean && detail !== 'clean' };
  if (searchClean) return { group: 'clean', evidence: 'search-filter', conflict: false };
  return { group: 'unknown', evidence: 'none', conflict: false };
}

const TRAMER_BUCKETS = ['none', '≤25 bin', '25–100 bin', '>100 bin', 'mentioned', 'unknown'] as const;

export const bucketOfAmount = (a: number): string =>
  a <= 0 ? 'none' : a <= 25_000 ? '≤25 bin' : a <= 100_000 ? '25–100 bin' : '>100 bin';

/** Yalnızca detay kaydı varsa (satıcı beyanı); özet kaydı için null. */
export function tramerBucketOf(view: Pick<RecordView, 'best' | 'full'>): string | null {
  if (!view.full) return null;
  const d = view.best as Partial<Listing>;
  if (d.tramerStatus === 'none') return 'none';
  if (d.tramerStatus === 'mentioned') return 'mentioned';
  if (d.tramerAmount !== null && d.tramerAmount !== undefined) return bucketOfAmount(d.tramerAmount);
  return 'unknown';
}

// ---------- eğim uydurma (Theil–Sen, 08 §4.2 Adım 4) ----------

export interface SlopeFit {
  /** ln fiyat / km; kapalıysa null. */
  bKm: number | null;
  /** ln fiyat / model yılı; kapalıysa null. */
  bYear: number | null;
  kmPairs: number;
  yearPairs: number;
  warnings: string[];
}

/**
 * Km eğimi yalnızca aynı model yılındaki çiftlerden (|Δkm| ≥ 10.000), yıl eğimi km'ye göre düzeltilmiş
 * log-fiyatlarla farklı yıllı çiftlerden; ikisi de medyan. Makul aralık dışı eğim sessizce kırpılmaz, kapatılır.
 */
export function fitSlopes(rows: ReadonlyArray<{ year: number; km: number; price: number }>, targetKm: number): SlopeFit {
  const warnings: string[] = [];
  const byYear = new Map<number, Array<readonly [number, number]>>();
  for (const r of rows) {
    const list = byYear.get(r.year) ?? [];
    list.push([r.km, Math.log(r.price)]);
    byYear.set(r.year, list);
  }
  const kmSlopes: number[] = [];
  for (const pts of byYear.values()) kmSlopes.push(...pairwiseSlopes(pts, KM_PAIR_MIN_DELTA));
  let bKm: number | null = null;
  if (kmSlopes.length < MIN_PAIRS) {
    warnings.push(`Km düzeltmesi kapatıldı: aynı model yılında yeterli ilan çifti yok (${kmSlopes.length} < ${MIN_PAIRS}).`);
  } else {
    const b = median(kmSlopes);
    if (b > 0 || b < KM_SLOPE_MIN) {
      warnings.push(
        `Km düzeltmesi kapatıldı: veriden çıkan km eğimi makul aralığın (10 bin km başına %0 ile %-4) dışında ` +
          `(${trNum((Math.exp(b * 10_000) - 1) * 100)}%).`,
      );
    } else bKm = b;
  }

  const adj = rows.map((r) => [r.year, Math.log(r.price) - (bKm ?? 0) * (r.km - targetKm)] as const);
  const yearCounts = new Map<number, number>();
  for (const r of rows) yearCounts.set(r.year, (yearCounts.get(r.year) ?? 0) + 1);
  const yearsWith3 = [...yearCounts.values()].filter((c) => c >= 3).length;
  const yearSlopes = pairwiseSlopes(adj, 0);
  let bYear: number | null = null;
  if (yearSlopes.length < MIN_PAIRS || yearsWith3 < 2) {
    warnings.push(
      'Model yılı düzeltmesi kapatıldı: en az 2 farklı model yılında 3\'er ilan ve 10 farklı yıllı ilan çifti gerekir ' +
        `(çift: ${yearSlopes.length}, yeterli yıl: ${yearsWith3}).`,
    );
  } else {
    const b = median(yearSlopes);
    if (b < 0 || b > YEAR_SLOPE_MAX) {
      warnings.push(
        `Model yılı düzeltmesi kapatıldı: veriden çıkan yıl eğimi makul aralığın (yıl başına %0 ile +%25) dışında ` +
          `(${trNum((Math.exp(b) - 1) * 100)}%).`,
      );
    } else bYear = b;
  }
  return { bKm, bYear, kmPairs: kmSlopes.length, yearPairs: yearSlopes.length, warnings };
}

/** p̂ = p · exp(bKm·(km_hedef − km) + bYear·(yıl_hedef − yıl)); kapalı eğim 0 sayılır. */
export function adjustedPrice(
  r: { price: number; year: number; km: number },
  fit: Pick<SlopeFit, 'bKm' | 'bYear'>,
  target: { year: number; km: number },
): number {
  return r.price * Math.exp((fit.bKm ?? 0) * (target.km - r.km) + (fit.bYear ?? 0) * (target.year - r.year));
}

// ---------- konum ve güven ----------

export interface Position {
  percentile: number;
  vsMedianPct: number;
  band: PositionBand;
  text: string;
}

export function positionOf(values: readonly number[], dist: Distribution, price: number): Position | null {
  if (dist.n < MIN_SHOWN_N || dist.p10 === null || dist.q1 === null || dist.q3 === null || dist.p90 === null) return null;
  const percentile = r0(midrankPercentile(values, price));
  const vs = r1((price / dist.median - 1) * 100);
  const band: PositionBand =
    price < dist.p10 ? 'well-below' : price < dist.q1 ? 'below' : price <= dist.q3 ? 'typical' : price <= dist.p90 ? 'above' : 'well-above';
  const where: Record<PositionBand, string> = {
    'well-below': 'P10\'un altında',
    below: 'P10 ile Q1 arası',
    typical: 'Q1 ile Q3 arası (orta çeyrekler)',
    above: 'Q3 ile P90 arası',
    'well-above': 'P90\'ın üzerinde',
  };
  const rel = Math.abs(vs) < 0.05 ? 'medyanla aynı düzeyde' : `medyanın %${trNum(Math.abs(vs))} ${vs > 0 ? 'üstünde' : 'altında'}`;
  const text =
    `Emsal ilanların yaklaşık %${percentile}'i bu fiyatın altında; ${rel} (${where[band]}). ` +
    'Bu bir değer hükmü değildir: pazarlık payı, donanım ve aracın durumu ayrıca değerlendirilmeli.';
  return { percentile, vsMedianPct: vs, band, text };
}

const LEVELS: Confidence[] = ['low', 'medium', 'high'];
const LEVEL_TR: Record<Confidence, string> = { insufficient: 'yetersiz', low: 'düşük', medium: 'orta', high: 'yüksek' };

export interface ConfidenceInput {
  n: number;
  /** Taban kurulamadı (ör. hedefe yakın emsal yok): seviye zorunlu `insufficient`. */
  noBasis?: string;
  medianAgeDays: number;
  damagePolicyFallback: boolean;
  iqrPct: number | null;
  narrowBandOffCenter: boolean;
  lowCoverage: boolean;
  /** Hedefin yıl/km bilgisi yok: emsal karşılaştırması yapılamadı (en fazla `low`). */
  noTargetYearKm: boolean;
}

/** Güven seviyesi (08 §4.2 Adım 7): n'den başlangıç, her koşul bir seviye düşürür (en düşük `low`). */
export function confidenceOf(c: ConfidenceInput): { level: Confidence; summary: string; reasons: string[] } {
  const reasons: string[] = [];
  const age = Math.floor(c.medianAgeDays);
  const tail = `gözlem yaşı medyanı ${age} gün`;
  if (c.noBasis !== undefined || c.n < 5) {
    reasons.push(c.noBasis ?? 'örnek yetersiz (n<5)');
    return { level: 'insufficient', summary: `n=${c.n}, güven yetersiz: ${reasons.join('; ')}`, reasons };
  }
  let i = c.n >= 25 ? 2 : c.n >= 10 ? 1 : 0;
  if (i === 0) reasons.push('örnek az (n<10)');
  const drop = (why: string) => {
    if (i > 0) i--;
    reasons.push(why);
  };
  if (c.medianAgeDays > OLD_OBSERVATION_DAYS) drop(`gözlem yaşı medyanı ${age} gün (>${OLD_OBSERVATION_DAYS})`);
  if (c.damagePolicyFallback) drop('hasar bilgisi bilinmeyen ilanlar da dahil edildi');
  if (c.iqrPct !== null && c.iqrPct > 30) drop(`dağılım geniş (çeyrekler arası açıklık medyanın %${trNum(c.iqrPct, 0)}'i)`);
  if (c.narrowBandOffCenter) drop('emsaller hedefin yıl/km değerinden uzakta toplanıyor');
  if (c.lowCoverage) drop('fiyata göre sıralı aramada kapsama düşük: örnek ucuz uca kayık olabilir');
  if (c.noTargetYearKm) {
    reasons.push('hedefin yıl/km bilgisi yok: emsal karşılaştırması yapılamadı');
    i = 0;
  }
  const level = LEVELS[i]!;
  return {
    level,
    summary: `n=${c.n}, ${LEVEL_TR[level]} güven${reasons.length ? `: ${reasons.join('; ')}` : ''}; ${tail}`,
    reasons,
  };
}

// ---------- ana giriş ----------

export interface ExcludedCounts {
  noPrice: number;
  otherCurrency: number;
  stale: number;
  implausible: number;
  duplicate: number;
  outlier: number;
  damageMismatch: number;
  missingYearOrKm: number;
  outsideWindow: number;
}

interface Row {
  id: string;
  view: RecordView;
  price: number;
  lastSeen: number;
  ageDays: number;
  year: number | null;
  km: number | null;
  damage: DamageInfo;
}

const latestPrice = (v: RecordView): { price: number | null; currency: string | null } => {
  for (let i = v.observations.length - 1; i >= 0; i--) {
    const o = v.observations[i]!;
    if (o.price !== null) return { price: o.price, currency: o.currency };
  }
  return { price: v.best.price, currency: v.best.currency };
};

const segmentFilterOf = (s: MarketSegment): Partial<SearchQuery> => {
  const { category: _category, ...rest } = s;
  return rest;
};

const segmentIsEmpty = (s: MarketSegment | undefined): boolean =>
  s === undefined || Object.values(s).every((v) => v === undefined || (Array.isArray(v) && v.length === 0));

function deriveSegment(view: RecordView, year: number | null, searches: Readonly<Record<string, SearchInfo>>): MarketSegment {
  const seg: MarketSegment = {};
  let category: string | null = null;
  for (let i = view.observations.length - 1; i >= 0 && category === null; i--) {
    const k = view.observations[i]!.searchKey;
    if (k !== undefined) category = searches[k]?.category ?? null;
  }
  if (category === null && view.best.brand && view.best.series) category = slugify(`${view.best.brand} ${view.best.series}`);
  if (category) seg.category = category;
  if (year !== null) {
    seg.yearMin = year - 1;
    seg.yearMax = year + 1;
  }
  if (view.best.transmission) seg.transmission = view.best.transmission;
  if (view.best.fuel) seg.fuel = view.best.fuel;
  return seg;
}

const describeSegment = (s: MarketSegment): string => {
  const parts: string[] = [];
  if (s.category) parts.push(`kategori ${s.category}`);
  if (s.brand) parts.push(`marka ${s.brand}`);
  if (s.models?.length) parts.push(`model ${s.models.join('/')}`);
  if (s.yearMin !== undefined || s.yearMax !== undefined) parts.push(`yıl ${s.yearMin ?? '…'}–${s.yearMax ?? '…'}`);
  if (s.kmMin !== undefined || s.kmMax !== undefined) parts.push(`km ${s.kmMin ?? 0}–${s.kmMax ?? '…'}`);
  if (s.city) parts.push(`şehir ${s.city}`);
  for (const k of ['transmission', 'fuel', 'sellerType', 'bodyType', 'enginePower', 'engineVolume'] as const) {
    if (s[k]) parts.push(`${k} ${s[k]}`);
  }
  return parts.length ? parts.join(', ') : 'tüm store';
};

export interface MarketStatsResult {
  segmentUsed: MarketSegment;
  method: {
    basis: Basis;
    kmSlopePctPer10k: number | null;
    yearSlopePct: number | null;
    kmPairs: number;
    yearPairs: number;
    window: { years: number; km: number };
    steps: string[];
  };
  sample: {
    candidates: number;
    used: number;
    withUnknownFields: number;
    excluded: ExcludedCounts;
    observationAgeDays: { median: number; max: number };
    damageEvidence: { detail: number; searchFilter: number; none: number };
    evidenceConflicts: number;
    damagePolicyFallback: boolean;
    coverage: Array<{ searchKey: string; seen: number; totalCount: number | null; sorting: string | null }>;
  };
  raw: ReturnType<typeof roundDist> | null;
  basisDistribution: ReturnType<typeof roundDist> | null;
  target: {
    source: 'ref' | 'input';
    id?: string;
    year: number | null;
    km: number | null;
    price: number | null;
    damage: DamageGroup;
    tramer: string | null;
    fairBand: { p10: number | null; q1: number | null; median: number; q3: number | null; p90: number | null } | null;
    position: Position | null;
  } | null;
  sameTrim: { trim: string; n: number; median: number | null } | null;
  damageBreakdown: Array<{
    group: DamageGroup;
    n: number;
    median: number | null;
    vsCleanMedianPct: number | null;
    evidence: { detail: number; searchFilter: number };
  }>;
  tramerBreakdown: Array<{ bucket: string; n: number; median: number | null }>;
  comparables: Array<{
    id: string;
    url: string;
    year: number | null;
    km: number | null;
    price: number;
    adjustedPrice: number | null;
    damage: DamageGroup;
    lastSeenAt: string;
  }>;
  confidence: { level: Confidence; summary: string; reasons: string[] };
  warnings: string[];
}

export function computeMarketStats(
  views: readonly RecordView[],
  searches: Readonly<Record<string, SearchInfo>>,
  input: MarketInput,
  now: Date,
  opts: MarketOptions = {},
): MarketStatsResult {
  const tv = opts.targetView;
  const ti = input.target;
  if (segmentIsEmpty(input.segment) && tv === undefined) {
    throw new Error('segment (en az category/brand/models) ya da target.ref gerekli');
  }

  // ---- Hedef ----
  const tYear = ti?.year ?? tv?.best.year ?? null;
  const tKm = ti?.km ?? tv?.best.km ?? null;
  let tPrice: number | null = ti?.price ?? null;
  const warnTarget: string[] = [];
  if (tPrice === null && tv) {
    const lp = latestPrice(tv);
    if ((lp.currency ?? 'TL') !== 'TL') warnTarget.push('Hedef ilan TL dışı para birimiyle; fiyat konumu hesaplanmadı (dönüşüm yapılmaz).');
    else tPrice = lp.price;
  }
  const targetDamageInfo = tv ? damageGroupOf(tv, now, input.maxAgeDays) : null;
  const tDamage: DamageGroup = ti?.damage ?? targetDamageInfo?.group ?? 'unknown';
  const hasTarget = ti !== undefined || tv !== undefined;
  const segment: MarketSegment = segmentIsEmpty(input.segment) ? deriveSegment(tv!, tYear, searches) : input.segment!;
  if (segmentIsEmpty(segment)) {
    throw new Error('Hedef ilandan segment türetilemedi; segment (en az category/brand/models) verin');
  }

  // ---- Adım 1: adaylar ----
  const filter = segmentFilterOf(segment);
  const candidates: RecordView[] = [];
  let withUnknownFields = 0;
  for (const v of views) {
    if (tv !== undefined && v.id === tv.id) continue;
    const ev = evaluateQuery(v.best, filter, { now });
    if (!ev.match) continue;
    if (segment.category !== undefined && !categoryMatches(v, searches, segment.category)) continue;
    candidates.push(v);
    if (ev.unknownFields.length > 0) withUnknownFields++;
  }

  // ---- Adım 2: temizlik ----
  const excluded: ExcludedCounts = {
    noPrice: 0, otherCurrency: 0, stale: 0, implausible: 0, duplicate: 0, outlier: 0,
    damageMismatch: 0, missingYearOrKm: 0, outsideWindow: 0,
  };
  let rows: Row[] = [];
  for (const v of candidates) {
    const lp = latestPrice(v);
    if (lp.price === null) {
      excluded.noPrice++;
      continue;
    }
    if ((lp.currency ?? 'TL') !== 'TL') {
      excluded.otherCurrency++;
      continue;
    }
    const lastSeen = Math.max(latestAt(v.observations), observationTime(v.best.capturedAt));
    const ageMs = now.getTime() - lastSeen;
    if (ageMs > input.maxAgeDays * DAY_MS) {
      excluded.stale++;
      continue;
    }
    if (lp.price < MIN_PLAUSIBLE_PRICE) {
      excluded.implausible++;
      continue;
    }
    rows.push({
      id: v.id,
      view: v,
      price: lp.price,
      lastSeen,
      ageDays: Math.max(0, ageMs / DAY_MS),
      year: v.best.year,
      km: v.best.km,
      damage: damageGroupOf(v, now, input.maxAgeDays),
    });
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // kopya: aynı (yıl, km, fiyat) -> en yeni görülen kalır
  const keep = new Map<string, Row>();
  for (const r of rows) {
    if (r.year === null || r.km === null) continue;
    const key = `${r.year}|${r.km}|${r.price}`;
    const cur = keep.get(key);
    if (!cur || r.lastSeen > cur.lastSeen) keep.set(key, r);
  }
  rows = rows.filter((r) => {
    if (r.year === null || r.km === null) return true;
    if (keep.get(`${r.year}|${r.km}|${r.price}`) === r) return true;
    excluded.duplicate++;
    return false;
  });

  if (rows.length >= OUTLIER_MIN_N) {
    const f = tukeyFences(rows.map((r) => Math.log(r.price)));
    rows = rows.filter((r) => {
      const l = Math.log(r.price);
      if (l >= f.lo && l <= f.hi) return true;
      excluded.outlier++;
      return false;
    });
  }
  const pool = rows;

  // ---- Hasar politikası ----
  const warnings: string[] = [];
  let damagePolicyFallback = false;
  let sel: Row[];
  if (input.damagePolicy === 'any') sel = pool;
  else if (input.damagePolicy === 'clean') sel = pool.filter((r) => r.damage.group === 'clean');
  else if (!hasTarget) sel = pool;
  else if (tDamage === 'unknown') {
    sel = pool;
    warnings.push('Hedefin hasar durumu bilinmiyor; tüm hasar grupları dahil edildi (damagePolicy: any gibi).');
  } else {
    const same = pool.filter((r) => r.damage.group === tDamage);
    if (same.length >= input.minSample) sel = same;
    else {
      const unknownRows = pool.filter((r) => r.damage.group === 'unknown');
      sel = [...same, ...unknownRows];
      if (unknownRows.length > 0) {
        damagePolicyFallback = true;
        warnings.push('Hasar bilgisi bilinmeyen ilanlar dahil edildi; hatasız bir araç için bant aşağı kayık olabilir.');
      }
    }
  }
  excluded.damageMismatch = pool.length - sel.length;

  const rawDist = sel.length > 0 ? describe(sel.map((r) => r.price)) : null;

  // ---- Adım 4: düzeltme / dar bant / ham ----
  const hasYK = tYear !== null && tKm !== null;
  let basis: Basis = 'raw-segment';
  let basisRows: Row[] = [];
  let basisValues: number[] = [];
  let adjustedById = new Map<string, number>();
  let fit: SlopeFit | null = null;
  let window = { years: 0, km: 0 };
  let noBasisReason: string | undefined;
  const stepList: string[] = [];
  let adjustedTried = false;
  let attemptNote: string | null = null;

  if (hasYK && input.adjust === 'auto') {
    const withYK = sel.filter((r): r is Row & { year: number; km: number } => r.year !== null && r.km !== null);
    if (withYK.length >= MIN_FIT_N) {
      adjustedTried = true;
      const f = fitSlopes(withYK, tKm!);
      fit = f;
      if (f.bKm !== null || f.bYear !== null) {
        const inWin = withYK.filter(
          (r) => Math.abs(r.year - tYear!) <= WINDOW_ADJ.years && Math.abs(r.km - tKm!) <= WINDOW_ADJ.km,
        );
        if (inWin.length >= input.minSample) {
          basis = 'adjusted';
          basisRows = inWin;
          window = WINDOW_ADJ;
          excluded.missingYearOrKm = sel.length - withYK.length;
          excluded.outsideWindow = withYK.length - inWin.length;
          adjustedById = new Map(inWin.map((r) => [r.id, adjustedPrice(r, f, { year: tYear!, km: tKm! })]));
          basisValues = inWin.map((r) => adjustedById.get(r.id)!);
        } else {
          attemptNote = `Düzeltme penceresinde (yıl ±2, km ±60 bin) yalnızca ${inWin.length} ilan var (< ${input.minSample}).`;
        }
      } else attemptNote = 'Hiçbir eğim güvenilir biçimde kestirilemedi.';
    } else attemptNote = `Düzeltme için en az ${MIN_FIT_N} yıl/km bilgili ilan gerekir (${withYK.length} var).`;
  } else if (hasYK && input.adjust === 'none') attemptNote = 'Düzeltme istenmedi (adjust: none).';

  let lowYK = false;
  if (basis !== 'adjusted') {
    if (!hasTarget) {
      basis = 'raw-segment';
      basisRows = sel;
      basisValues = sel.map((r) => r.price);
    } else if (!hasYK) {
      lowYK = true;
      basis = 'raw-segment';
      basisRows = sel;
      basisValues = sel.map((r) => r.price);
    } else {
      const band = sel.filter(
        (r) =>
          r.year !== null && r.km !== null &&
          Math.abs(r.year - tYear!) <= WINDOW_BAND.years && Math.abs(r.km - tKm!) <= WINDOW_BAND.km,
      );
      if (band.length >= MIN_SHOWN_N) {
        basis = 'narrow-band';
        basisRows = band;
        basisValues = band.map((r) => r.price);
        window = WINDOW_BAND;
      } else {
        basis = 'raw-segment';
        if (sel.length < MIN_SHOWN_N) {
          basisRows = sel;
          basisValues = sel.map((r) => r.price);
        } else {
          noBasisReason = `hedefe yakın emsal yok (yıl ±1, km ±30 bin içinde ${band.length} ilan)`;
        }
      }
    }
  }
  const basisDist = basisValues.length > 0 ? describe(basisValues) : null;

  // ---- Kapsama (08 §4.2 Adım 7) ----
  const candidateKeys = new Set<string>();
  for (const v of candidates) for (const o of v.observations) if (o.searchKey !== undefined) candidateKeys.add(o.searchKey);
  const seenByKey = new Map<string, Set<string>>();
  for (const v of views) {
    for (const o of v.observations) {
      if (o.searchKey === undefined || !candidateKeys.has(o.searchKey)) continue;
      (seenByKey.get(o.searchKey) ?? seenByKey.set(o.searchKey, new Set()).get(o.searchKey)!).add(v.id);
    }
  }
  const coverage = [...seenByKey.entries()]
    .map(([searchKey, ids]) => ({
      searchKey,
      seen: ids.size,
      totalCount: searches[searchKey]?.totalCount ?? null,
      sorting: searches[searchKey]?.sorting ?? null,
    }))
    .sort((a, b) => b.seen - a.seen || (a.searchKey < b.searchKey ? -1 : 1));
  const lowCoverageRows = coverage.filter(
    (c) => c.sorting === 'price_asc' && c.totalCount !== null && c.totalCount > 0 && c.seen / c.totalCount < LOW_COVERAGE,
  );

  // ---- Gözlem yaşı ve kanıt ----
  const ageRows = basisRows.length > 0 ? basisRows : sel;
  const ages = ageRows.map((r) => r.ageDays);
  const ageMedian = ages.length ? median(ages) : 0;
  const ageMax = ages.length ? Math.max(...ages) : 0;
  const usedRows = basisRows;
  const evidenceCount = { detail: 0, searchFilter: 0, none: 0 };
  for (const r of usedRows) {
    if (r.damage.evidence === 'detail') evidenceCount.detail++;
    else if (r.damage.evidence === 'search-filter') evidenceCount.searchFilter++;
    else evidenceCount.none++;
  }
  const evidenceConflicts = pool.filter((r) => r.damage.conflict).length;

  // ---- Güven ----
  let offCenter = false;
  if (basis === 'narrow-band' && basisRows.length > 0) {
    const medKm = median(basisRows.map((r) => r.km!));
    const medYear = median(basisRows.map((r) => r.year!));
    offCenter = Math.abs(medKm - tKm!) > WINDOW_BAND.km / 2 || Math.abs(medYear - tYear!) >= 1;
  }
  const confidence = confidenceOf({
    n: basisRows.length > 0 ? basisRows.length : sel.length,
    ...(noBasisReason !== undefined ? { noBasis: noBasisReason } : {}),
    medianAgeDays: ageMedian,
    damagePolicyFallback,
    iqrPct: basisDist?.iqrPct ?? null,
    narrowBandOffCenter: offCenter,
    lowCoverage: lowCoverageRows.length > 0,
    noTargetYearKm: lowYK,
  });
  const insufficient = confidence.level === 'insufficient';

  // ---- Dağılımlar, hedef çıktısı ----
  const fairBand =
    hasTarget && basisDist && !lowYK
      ? insufficient
        ? { p10: null, q1: null, median: r0(basisDist.median), q3: null, p90: null }
        : {
            p10: basisDist.p10 === null ? null : r0(basisDist.p10),
            q1: basisDist.q1 === null ? null : r0(basisDist.q1),
            median: r0(basisDist.median),
            q3: basisDist.q3 === null ? null : r0(basisDist.q3),
            p90: basisDist.p90 === null ? null : r0(basisDist.p90),
          }
      : null;
  const comparableBase = hasTarget && hasYK && basis !== 'raw-segment';
  const position =
    hasTarget && tPrice !== null && basisDist && !insufficient && !lowYK ? positionOf(basisValues, basisDist, tPrice) : null;
  const tramerLabel = ti?.tramerAmount !== undefined ? bucketOfAmount(ti.tramerAmount) : tv ? tramerBucketOf(tv) : null;

  let sameTrim: MarketStatsResult['sameTrim'] = null;
  if (ti?.trim) {
    const want = foldTr(ti.trim);
    const hit = sel.filter((r) => foldTr(`${r.view.best.title} ${r.view.best.model ?? ''}`).includes(want));
    sameTrim = { trim: ti.trim, n: hit.length, median: medOrNull(hit.map((r) => r.price)) };
  }

  // ---- Hasar ve tramer tabloları (düzeltmeye GİRMEZ) ----
  const groups: DamageGroup[] = ['clean', 'painted', 'replaced', 'heavy', 'unknown'];
  const cleanMedian = medOrNull(pool.filter((r) => r.damage.group === 'clean').map((r) => r.price));
  const damageBreakdown = groups
    .map((g) => {
      const rs = pool.filter((r) => r.damage.group === g);
      const med = medOrNull(rs.map((r) => r.price));
      return {
        group: g,
        n: rs.length,
        median: med,
        vsCleanMedianPct: g !== 'clean' && med !== null && cleanMedian !== null ? r1((med / cleanMedian - 1) * 100) : null,
        evidence: {
          detail: rs.filter((r) => r.damage.evidence === 'detail').length,
          searchFilter: rs.filter((r) => r.damage.evidence === 'search-filter').length,
        },
      };
    })
    .filter((g) => g.n > 0);
  const tramerBreakdown = TRAMER_BUCKETS.map((bucket) => {
    const rs = pool.filter((r) => tramerBucketOf(r.view) === bucket);
    return { bucket, n: rs.length, median: medOrNull(rs.map((r) => r.price)) };
  }).filter((b) => b.n > 0);

  // ---- Emsaller ----
  const comparables: MarketStatsResult['comparables'] = [];
  if (comparableBase && input.comparables > 0 && !insufficient) {
    const ranked = basisRows
      .slice()
      .sort(
        (a, b) =>
          Math.abs(a.year! - tYear!) * 30_000 + Math.abs(a.km! - tKm!) -
            (Math.abs(b.year! - tYear!) * 30_000 + Math.abs(b.km! - tKm!)) || (a.id < b.id ? -1 : 1),
      );
    for (const r of ranked.slice(0, input.comparables)) {
      comparables.push({
        id: r.id,
        url: r.view.best.url,
        year: r.year,
        km: r.km,
        price: r.price,
        adjustedPrice: adjustedById.has(r.id) ? r0(adjustedById.get(r.id)!) : null,
        damage: r.damage.group,
        lastSeenAt: new Date(r.lastSeen).toISOString(),
      });
    }
  }

  // ---- Yöntem açıklaması (her adım bir cümle) ----
  stepList.push(
    `Segment: ${describeSegment(segment)}; ${candidates.length} aday ilan bulundu${tv ? ' (hedef ilan hariç)' : ''}.`,
  );
  const removed =
    excluded.noPrice + excluded.otherCurrency + excluded.stale + excluded.implausible + excluded.duplicate + excluded.outlier;
  stepList.push(
    `Temizlik: fiyatsız, TL dışı, ${input.maxAgeDays} günden eski gözlemli, ${MIN_PLAUSIBLE_PRICE.toLocaleString('tr-TR')} TL altı, ` +
      `kopya ve uç aykırı fiyatlı ilanlar çıkarıldı (${removed} ilan); ${pool.length} ilan kaldı.`,
  );
  stepList.push(
    `Hasar politikası (${input.damagePolicy}): hasar/boya/tramer düzeltmeye girmez; ${sel.length} ilan hasar grubuna göre seçildi, ` +
      'gruplar ayrı tablolarda raporlanır.',
  );
  if (basis === 'adjusted' && fit) {
    stepList.push(
      `Düzeltme: km eğimi ${fit.bKm !== null ? `10 bin km başına %${trNum((Math.exp(fit.bKm * 10_000) - 1) * 100)}` : 'kapalı'}, ` +
        `model yılı eğimi ${fit.bYear !== null ? `yıl başına %${trNum((Math.exp(fit.bYear) - 1) * 100)}` : 'kapalı'} ` +
        `(Theil–Sen: ${fit.kmPairs} km çifti, ${fit.yearPairs} yıl çifti).`,
    );
    stepList.push(
      `Her emsal fiyatı hedefin yılına ve km'sine taşındı; yıl ±2 ve km ±60 bin penceresindeki ${basisRows.length} ilan kullanıldı.`,
    );
  } else {
    if (attemptNote) stepList.push(`Düzeltme yapılamadı: ${attemptNote}`);
    if (basis === 'narrow-band') {
      stepList.push(`Dar emsal bandı: yıl ±1 ve km ±30 bin içindeki ${basisRows.length} ilanın ham fiyatları kullanıldı.`);
    } else if (hasTarget && !lowYK && noBasisReason) {
      stepList.push(`Dar emsal bandında yeterli ilan yok; yalnızca segmentin ham dağılımı (raw) raporlandı, emsal bandı ve konum verilmedi.`);
    } else {
      stepList.push(`Segmentin ham fiyatları (${basisValues.length} ilan) doğrudan kullanıldı.`);
    }
  }
  if (position) stepList.push('Konum: hedef fiyatın, emsal fiyatlar içindeki orta-sıra yüzdeliği ve medyana göre farkı hesaplandı.');
  if (fairBand && !insufficient) stepList.push('Emsal bandı: P10, Q1, medyan, Q3 ve P90 doğrusal enterpolasyonlu yüzdeliklerle (Excel PERCENTILE.INC) hesaplandı.');

  // ---- Uyarılar ----
  const allWarnings: string[] = [
    'Fiyatlar ilan (istek) fiyatıdır; gerçekleşen satış fiyatı değildir ve genellikle daha düşüktür.',
    'Yalnızca sizin kaydettiğiniz sayfalara dayanır; piyasanın tamamı değildir.',
  ];
  if (candidates.length === 0) {
    allWarnings.push('Segmentte ilan yok; search_cars\'ın searchUrls\'ini kaydedip içe aktarın.');
  }
  allWarnings.push(...warnTarget);
  if (insufficient && candidates.length > 0) {
    allWarnings.push('Örnek yetersiz: fiyat konumu ve güvenilir bir emsal bandı verilmedi; kesin yorum yapmayın.');
  }
  if (ageMedian > OLD_OBSERVATION_DAYS) {
    allWarnings.push(
      `Gözlemlerin yaş medyanı ${Math.floor(ageMedian)} gün; TL nominal fiyatlar enflasyon nedeniyle eskimiş olabilir.`,
    );
  }
  allWarnings.push(...warnings);
  if (lowCoverageRows.length > 0) {
    allWarnings.push(
      'Fiyata göre artan sıralı arama sonuçlarının yalnızca bir kısmı kayıtlı; örnek ucuz uca kayık olabilir ' +
        '(tüm sayfaları ya da date_desc sıralı sayfaları kaydedin).',
    );
  }
  if (fit) {
    allWarnings.push(...fit.warnings);
  }
  if (sameTrim && sameTrim.n < 3) {
    allWarnings.push(`Donanım "${sameTrim.trim}" için yeterli eşleşen ilan yok (n=${sameTrim.n}); donanım farkı düzeltilmez.`);
  }
  if (damageBreakdown.length > 0 || tramerBreakdown.length > 0) {
    allWarnings.push(
      'Hasar/tramer tabloları gözlemsel farktır, neden-sonuç değildir; bilgiler satıcı beyanına dayanır. ' +
        'Resmi tramer sorgusu ve bağımsız ekspertiz yaptırın.',
    );
  }
  if (withUnknownFields > 0) {
    allWarnings.push(`${withUnknownFields} aday ilanda segment alanlarından biri bilinmiyor (dahil edildi).`);
  }

  const kmPct = fit && basis === 'adjusted' && fit.bKm !== null ? r2((Math.exp(fit.bKm * 10_000) - 1) * 100) : null;
  const yearPct = fit && basis === 'adjusted' && fit.bYear !== null ? r2((Math.exp(fit.bYear) - 1) * 100) : null;

  return {
    segmentUsed: segment,
    method: {
      basis,
      kmSlopePctPer10k: kmPct,
      yearSlopePct: yearPct,
      kmPairs: adjustedTried && fit ? fit.kmPairs : 0,
      yearPairs: adjustedTried && fit ? fit.yearPairs : 0,
      window,
      steps: stepList,
    },
    sample: {
      candidates: candidates.length,
      used: usedRows.length,
      withUnknownFields,
      excluded,
      observationAgeDays: { median: r0(ageMedian), max: r0(ageMax) },
      damageEvidence: evidenceCount,
      evidenceConflicts,
      damagePolicyFallback,
      coverage,
    },
    raw: rawDist ? roundDist(rawDist) : null,
    basisDistribution: basisDist && !noBasisReason ? roundDist(basisDist) : null,
    target: hasTarget
      ? {
          source: tv ? 'ref' : 'input',
          ...(tv ? { id: tv.id } : {}),
          year: tYear,
          km: tKm,
          price: tPrice,
          damage: tDamage,
          tramer: tramerLabel,
          fairBand,
          position,
        }
      : null,
    sameTrim,
    damageBreakdown,
    tramerBreakdown,
    comparables,
    confidence,
    warnings: allWarnings,
  };
}
