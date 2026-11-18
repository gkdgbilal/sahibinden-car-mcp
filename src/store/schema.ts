import type { Listing, ListingSummary } from '../sahibinden/types.js';

// Store şeması v2 (docs/08-V030-ANALYSIS.md §2). Bu dosya saftır: I/O, saat ve ortam yok.
export const STORE_SCHEMA_VERSION = 2;

/** İlan başına gözlem üst sınırı (08 §2.4). */
export const MAX_OBSERVATIONS = 200;

/** URL'de POZİTİF görülen sahibinden hasar filtreleri (parametre görünmemesi = bilinmiyor). */
export type UrlFilterFlag = 'unpainted' | 'noReplaced' | 'noHeavyDamage';

export interface PricePoint {
  price: number;
  currency: string;
  capturedAt: string;
}

export interface ImportedFile {
  file: string;
  importedAt: string;
  /** Dosyayı okuyan parser sürümü; yoksa eski kayıt (1) sayılır. */
  parserVersion?: number;
}

export interface Observation {
  /** ISO; sayfanın yakalanma anı (dosya mtime ya da import/live anı). */
  at: string;
  kind: 'search' | 'listing';
  price: number | null;
  currency: string | null;
  /** Yalnızca kind='search': normalize arama anahtarı. */
  searchKey?: string;
  /** Yalnızca kind='search' ve URL'de görüldüyse. */
  filters?: UrlFilterFlag[];
  /** v1'den taşındı: zaman = eski içe aktarma anı (yaklaşık). */
  approx?: true;
}

export interface StoredEntryV2 {
  summary?: ListingSummary;
  listing?: Listing;
  /** Geriye uyum: gözlemlerden türetilir (ardışık aynı fiyatlar birleşik). */
  priceHistory: PricePoint[];
  /** Zaman sıralı, (kind|at|searchKey) ile tekil; üst sınır MAX_OBSERVATIONS. */
  observations?: Observation[];
}

export interface SearchInfo {
  path: string;
  category: string | null;
  filters: UrlFilterFlag[];
  sorting: string | null;
  /** Sorgu dizesi (gürültü parametreleri atıldıktan sonra) en az bir adayda görüldü mü. */
  filtersKnown: boolean;
  firstObservedAt: string;
  lastObservedAt: string;
  /** Son gözlemdeki "aramanızda N ilan bulundu". */
  totalCount: number | null;
}

/** `recordSearch` girdisi: SearchInfo'nun gözlem anına indirgenmiş hâli. */
export type RecordSearchInfo = Omit<SearchInfo, 'firstObservedAt' | 'lastObservedAt'> & { at: string };

export interface WatchItem {
  addedAt: string;
  updatedAt: string;
  /** ≤500 karakter, telefon kalıbı yok (handler denetler). */
  note?: string;
  priceAtAdd: number | null;
  currencyAtAdd: string | null;
}

export interface StoredEntryV1 {
  summary?: ListingSummary;
  listing?: Listing;
  priceHistory: PricePoint[];
}

export interface StoreDataV1 {
  version: 1;
  listings: Record<string, StoredEntryV1>;
  importedFiles: Record<string, ImportedFile>;
}

export interface StoreDataV2 {
  version: 2;
  listings: Record<string, StoredEntryV2>;
  importedFiles: Record<string, ImportedFile>;
  searches: Record<string, SearchInfo>;
  watchlist: Record<string, WatchItem>;
  migratedFrom?: 1;
  migratedAt?: string;
}

/** Aracın (analytics/tool) gördüğü dar kayıt görünümü (08 §2.5). */
export interface RecordView {
  id: string;
  /** listing ?? summary */
  best: Listing | ListingSummary;
  full: boolean;
  /** Zaman sıralı. */
  observations: Observation[];
}

export interface InsightStore {
  records(): RecordView[];
  record(id: string): RecordView | undefined;
  searches(): Readonly<Record<string, SearchInfo>>;
  watchlist(): Readonly<Record<string, WatchItem>>;
  watchUpsert(id: string, patch: Partial<WatchItem>, at: string): WatchItem;
  watchRemove(id: string): boolean;
  save(): void;
}

// ---------- gözlem yardımcıları (saf) ----------

const tsOf = (at: string): number => {
  const t = Date.parse(at);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** Gözlemin zaman değeri (ms); ayrıştırılamazsa -Infinity. */
export const observationTime = tsOf;

export const observationKey = (o: Pick<Observation, 'kind' | 'at' | 'searchKey'>): string =>
  `${o.kind}|${o.at}|${o.searchKey ?? ''}`;

/** Toplam sıra: zaman, sonra kind, sonra searchKey; ekleme sırasından bağımsız aynı liste. */
export function compareObservations(a: Observation, b: Observation): number {
  const ta = tsOf(a.at);
  const tb = tsOf(b.at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const ka = a.searchKey ?? '';
  const kb = b.searchKey ?? '';
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}

const samePrice = (a: Observation, b: Observation) => a.price === b.price && a.currency === b.currency;

/**
 * Sınır aşılırsa önce fiyat koşularının iç noktaları (önceki ve sonraki gözlemle aynı fiyat)
 * en eskiden başlayarak atılır; koşu sınırları ve en yeni gözlem kalır. İç nokta yoksa en eski atılır.
 */
export function capObservations(list: Observation[], max: number = MAX_OBSERVATIONS): Observation[] {
  const out = list.slice();
  while (out.length > max) {
    let drop = -1;
    for (let i = 1; i < out.length - 1; i++) {
      if (samePrice(out[i - 1]!, out[i]!) && samePrice(out[i]!, out[i + 1]!)) {
        drop = i;
        break;
      }
    }
    out.splice(drop === -1 ? 0 : drop, 1);
  }
  return out;
}

const sameContent = (a: Observation, b: Observation) =>
  a.price === b.price &&
  a.currency === b.currency &&
  (a.filters ?? []).join(',') === (b.filters ?? []).join(',');

/**
 * Tekil anahtarla (kind|at|searchKey) sıralı ekleme. Anahtar varsa gözlem sayısı değişmez (idempotent):
 * içerik de aynıysa liste aynen kalır (`changed: false`); parser düzeltmesiyle fiyat/filtre farklıysa
 * aynı yakalamanın gözlemi yerinde güncellenir (`changed: true`).
 */
export function insertObservation(
  list: readonly Observation[],
  o: Observation,
): { list: Observation[]; inserted: boolean } {
  const key = observationKey(o);
  const at = list.findIndex((x) => observationKey(x) === key);
  if (at !== -1) {
    const prev = list[at]!;
    if (sameContent(prev, o)) return { list: list.slice(), inserted: false };
    const out = list.slice();
    out[at] = o;
    return { list: out, inserted: true };
  }
  const out = list.slice();
  let i = out.length;
  while (i > 0 && compareObservations(out[i - 1]!, o) > 0) i--;
  out.splice(i, 0, o);
  return { list: capObservations(out), inserted: true };
}

/** Ardışık aynı (fiyat, para birimi) gözlemleri tek noktada birleştirir; nokta zamanı = koşunun ilk gözlemi. */
export function derivePriceHistory(obs: readonly Observation[]): PricePoint[] {
  const out: PricePoint[] = [];
  for (const o of obs) {
    if (o.price === null) continue;
    const currency = o.currency ?? 'TL';
    const last = out[out.length - 1];
    if (last && last.price === o.price && last.currency === currency) continue;
    out.push({ price: o.price, currency, capturedAt: o.at });
  }
  return out;
}

// ---------- v1 -> v2 (saf) ----------

function migrateEntry(e: StoredEntryV1): StoredEntryV2 {
  let obs: Observation[] = [];
  const add = (o: Observation) => {
    obs = insertObservation(obs, o).list;
  };
  const defaultKind: Observation['kind'] = e.listing ? 'listing' : 'search';
  for (const p of e.priceHistory ?? []) {
    const kind: Observation['kind'] =
      e.listing && p.capturedAt === e.listing.capturedAt
        ? 'listing'
        : e.summary && p.capturedAt === e.summary.capturedAt
          ? 'search'
          : defaultKind;
    add({ at: p.capturedAt, kind, price: p.price, currency: p.currency, approx: true });
  }
  if (e.summary) {
    add({ at: e.summary.capturedAt, kind: 'search', price: e.summary.price, currency: e.summary.currency, approx: true });
  }
  if (e.listing) {
    add({ at: e.listing.capturedAt, kind: 'listing', price: e.listing.price, currency: e.listing.currency, approx: true });
  }
  return {
    ...(e.summary ? { summary: e.summary } : {}),
    ...(e.listing ? { listing: e.listing } : {}),
    priceHistory: derivePriceHistory(obs),
    observations: obs,
  };
}

/** v1 -> v2; girdiyi değiştirmez, aynı girdiyle her zaman aynı sonucu verir. */
export function migrateV1(v1: StoreDataV1, migratedAt: string): StoreDataV2 {
  const listings: Record<string, StoredEntryV2> = {};
  for (const [id, e] of Object.entries(v1.listings)) listings[id] = migrateEntry(e);
  return {
    version: 2,
    listings,
    importedFiles: { ...v1.importedFiles },
    searches: {},
    watchlist: {},
    migratedFrom: 1,
    migratedAt,
  };
}
