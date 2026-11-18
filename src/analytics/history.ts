import { compareObservations, observationTime } from '../store/schema.js';
import type { Observation, RecordView, SearchInfo } from '../store/schema.js';

// Fiyat düşüşü ve yaşam döngüsü (docs/08-V030-ANALYSIS.md §3). Saf: saat parametre, I/O ve ortam yok.

export const DAY_MS = 86_400_000;

/** Aynı (fiyat, para birimi) ardışık gözlemlerinin oluşturduğu koşu. */
export interface PriceRun {
  price: number;
  currency: string;
  firstAt: string;
  lastAt: string;
  n: number;
  /** Koşunun ilk/son gözlemi v1'den taşınmış (yaklaşık zaman) mı. */
  firstApprox: boolean;
  lastApprox: boolean;
}

const cur = (o: Observation): string => o.currency ?? 'TL';

const sortedObs = (obs: readonly Observation[]): Observation[] => obs.slice().sort(compareObservations);

/**
 * Fiyatlı gözlemlerden koşular (ardışık aynı fiyat birleşir). `currency` verilirse yalnızca o para birimi
 * dikkate alınır (araya giren başka para birimli gözlemler koşuyu bölmez). Para birimi boşsa TL sayılır.
 */
export function priceRuns(obs: readonly Observation[], currency?: string): PriceRun[] {
  const runs: PriceRun[] = [];
  for (const o of sortedObs(obs)) {
    if (o.price === null) continue;
    if (currency !== undefined && cur(o) !== currency) continue;
    const last = runs[runs.length - 1];
    if (last && last.price === o.price && last.currency === cur(o)) {
      last.lastAt = o.at;
      last.lastApprox = o.approx === true;
      last.n += 1;
    } else {
      runs.push({
        price: o.price,
        currency: cur(o),
        firstAt: o.at,
        lastAt: o.at,
        n: 1,
        firstApprox: o.approx === true,
        lastApprox: o.approx === true,
      });
    }
  }
  return runs;
}

export interface DropOptions {
  withinDays: number;
  minDropPct: number;
  minDropTl: number;
}

export interface DropInfo {
  currentPrice: number;
  peakPrice: number;
  firstPrice: number;
  dropTl: number;
  /** 1 ondalığa yuvarlanmış. */
  dropPct: number;
  totalChangePct: number;
  /** [önceki koşunun son görüldüğü an, mevcut koşunun ilk görüldüğü an]: düşüş bu aralıkta olmuştur. */
  detectedBetween: [string, string];
  pricePoints: number;
  reboundDrop: boolean;
  flags: string[];
}

export interface DropDetection {
  outcome: 'drop' | 'none' | 'other-currency' | 'no-price';
  /** Geçmişte TL dışı gözlem de var (yalnızca TL gözlemleri kullanıldı). */
  currencyChanged: boolean;
  /** TL koşu sayısı. */
  runCount: number;
  drop?: DropInfo;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** 08 §3.1 adım 1–8. */
export function detectDrop(view: Pick<RecordView, 'observations'>, now: Date, opts: DropOptions): DropDetection {
  const priced = sortedObs(view.observations).filter((o) => o.price !== null);
  const lastPriced = priced[priced.length - 1];
  if (!lastPriced) return { outcome: 'no-price', currencyChanged: false, runCount: 0 };
  if (cur(lastPriced) !== 'TL') return { outcome: 'other-currency', currencyChanged: false, runCount: 0 };
  const currencyChanged = priced.some((o) => cur(o) !== 'TL');

  const runs = priceRuns(priced, 'TL');
  const base = { currencyChanged, runCount: runs.length };
  if (runs.length < 2) return { outcome: 'none', ...base };

  const current = runs[runs.length - 1]!;
  const windowStart = now.getTime() - opts.withinDays * DAY_MS;
  if (observationTime(current.firstAt) < windowStart) return { outcome: 'none', ...base };

  // Referans: pencere başında geçerli olan koşu + pencere içinde başlayan önceki koşular (mevcut hariç).
  // Koşu i, bir sonraki koşunun başlangıcı pencere başından sonraysa pencerede (ya da başında) geçerliydi.
  let peak: PriceRun | null = null;
  for (let i = 0; i < runs.length - 1; i++) {
    if (observationTime(runs[i + 1]!.firstAt) <= windowStart) continue;
    if (peak === null || runs[i]!.price > peak.price) peak = runs[i]!;
  }
  if (peak === null) return { outcome: 'none', ...base };

  const dropTl = peak.price - current.price;
  const dropPctRaw = (dropTl / peak.price) * 100;
  if (!(dropTl > 0 && dropPctRaw >= opts.minDropPct && dropTl >= opts.minDropTl)) return { outcome: 'none', ...base };

  const prev = runs[runs.length - 2]!;
  const first = runs[0]!;
  const flags: string[] = [];
  if (current.firstApprox || prev.lastApprox) flags.push('approximate-dates');
  if (currencyChanged) flags.push('currency-changed');
  return {
    outcome: 'drop',
    ...base,
    drop: {
      currentPrice: current.price,
      peakPrice: peak.price,
      firstPrice: first.price,
      dropTl,
      dropPct: round1(dropPctRaw),
      totalChangePct: round1(((current.price - first.price) / first.price) * 100),
      detectedBetween: [prev.lastAt, current.firstAt],
      pricePoints: runs.length,
      reboundDrop: current.price >= first.price,
      flags,
    },
  };
}

/** Tüm para birimleriyle fiyat geçmişi (get_listing.tracking için). from/to = o fiyatta ilk/son görülme. */
export function priceHistoryOf(
  view: Pick<RecordView, 'observations'>,
): { price: number; currency: string; from: string; to: string }[] {
  return priceRuns(view.observations).map((r) => ({ price: r.price, currency: r.currency, from: r.firstAt, to: r.lastAt }));
}

export type LifecycleStatus = 'seen-recently' | 'not-seen-recently' | 'not-rechecked';

export interface Lifecycle {
  firstSeenAt: string;
  lastSeenAt: string;
  daysSinceLastSeen: number;
  status: LifecycleStatus;
  approximate: boolean;
  /** Aynı aramanın son kaydı (arama bağlamı biliniyorsa). */
  recheckedAt: string | null;
}

/**
 * 08 §3.2. "not-seen-recently" yalnızca ilanın son arama gözleminin arama anahtarı bilinen filtreliyse
 * (filtersKnown) ve aynı arama ilanın son görülmesinden SONRA tekrar kaydedildiyse söylenir;
 * aksi halde "not-rechecked" (bilgi yok). Kesin "kaldırıldı" hükmü asla verilmez.
 */
export function lifecycleOf(
  view: Pick<RecordView, 'observations' | 'best'>,
  searches: Readonly<Record<string, SearchInfo>>,
  now: Date,
  notSeenDays: number,
): Lifecycle {
  const obs = sortedObs(view.observations);
  let firstSeenAt: string;
  let lastSeenAt: string;
  let approximate: boolean;
  if (obs.length === 0) {
    firstSeenAt = lastSeenAt = view.best.capturedAt;
    approximate = true;
  } else {
    const first = obs[0]!;
    const last = obs[obs.length - 1]!;
    firstSeenAt = first.at;
    lastSeenAt = last.at;
    approximate = first.approx === true || last.approx === true;
  }
  const days = Math.max(0, Math.floor((now.getTime() - observationTime(lastSeenAt)) / DAY_MS));

  const lastSearch = obs.filter((o) => o.kind === 'search' && o.searchKey !== undefined).pop();
  const info = lastSearch?.searchKey !== undefined ? searches[lastSearch.searchKey] : undefined;
  const searchKnown = info !== undefined && info.filtersKnown;
  const rechecked = searchKnown && observationTime(info.lastObservedAt) > observationTime(lastSeenAt);

  let status: LifecycleStatus;
  if (days < notSeenDays) status = 'seen-recently';
  else status = rechecked ? 'not-seen-recently' : 'not-rechecked';

  return {
    firstSeenAt,
    lastSeenAt,
    daysSinceLastSeen: days,
    status,
    approximate,
    recheckedAt: status !== 'not-rechecked' && searchKnown ? info.lastObservedAt : null,
  };
}

/** İnsan okunur not; "satıldı/kaldırıldı" kesin hükmü vermez. */
export function lifecycleNote(lc: Lifecycle): string | null {
  if (lc.status === 'not-seen-recently') {
    const d = (lc.recheckedAt ?? '').slice(0, 10);
    return (
      `Son ${lc.daysSinceLastSeen} gündür görülmedi. Aynı arama ${d} tarihinde tekrar kaydedildi, bu ilan görünmedi: ` +
      'kaldırılmış olabilir; sonraki sayfalarda, farklı sıralamada veya fiyatı değiştiği için filtre dışında da olabilir. ' +
      'Kesin bilgi için ilanı tarayıcıda açın.'
    );
  }
  if (lc.status === 'not-rechecked') {
    return (
      `Son ${lc.daysSinceLastSeen} gündür kaydedilen sayfalarda görülmedi; ancak aynı arama sonradan kaydedilmediği için ` +
      'ilanın durumu bilinmiyor.'
    );
  }
  return null;
}
