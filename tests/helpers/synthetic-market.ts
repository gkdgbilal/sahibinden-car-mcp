import type { MarketInput } from '../../src/analytics/market.js';
import type { Listing } from '../../src/sahibinden/types.js';
import type { RecordView } from '../../src/store/schema.js';
import { listing, NOW, ob, summary } from './views.js';

/** Sabit tohumlu basit LCG (0 <= x < 1); deterministik. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Uydurma model: 150 bin km, 2011 için 800 bin TL; 10 bin km başına %-1,2; model yılı başına %+6. */
export const modelPrice = (year: number, km: number, noise = 0): number =>
  Math.round(800000 * 0.988 ** ((km - 150000) / 10000) * 1.06 ** (year - 2011) * (1 + noise));

export interface SynthOptions {
  n: number;
  seed?: number;
  /** Gürültü genliği (±), varsayılan 0,03. */
  noise?: number;
  /** Gözlem yaşı üst sınırı (gün); varsayılan 20. */
  maxAgeDays?: number;
  /** İlan no başlangıcı (benzersiz id için). */
  idBase?: number;
}

const idOf = (base: number, i: number) => String(base + i).padStart(10, '0');

export const isoDaysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** Arama özetli (detaysız) sentetik ilanlar: 2010-2012, 120-280 bin km (yıl eskidikçe km yükselir). */
export function syntheticMarket(o: SynthOptions): RecordView[] {
  const rnd = lcg(o.seed ?? 7);
  const noise = o.noise ?? 0.03;
  const out: RecordView[] = [];
  for (let i = 0; i < o.n; i++) {
    const year = 2010 + Math.floor(rnd() * 3);
    const km = Math.round((140000 + (2012 - year) * 20000 + rnd() * 100000) / 1000) * 1000;
    const price = modelPrice(year, km, (rnd() * 2 - 1) * noise);
    const at = isoDaysAgo(Math.floor(rnd() * (o.maxAgeDays ?? 20)));
    out.push(row(idOf(o.idBase ?? 2000000000, i), { year, km, price, at }));
  }
  return out;
}

export interface RowSpec {
  year: number | null;
  km: number | null;
  price: number | null;
  currency?: 'TL' | 'EUR' | 'USD';
  at?: string;
  title?: string;
  filters?: Array<'unpainted' | 'noReplaced' | 'noHeavyDamage'>;
  searchKey?: string;
  damage?: Listing['damage'];
  heavyDamage?: boolean | null;
  tramerAmount?: number | null;
  tramerStatus?: Listing['tramerStatus'];
}

/** Arama özeti (ya da `damage/heavyDamage/tramer` verilirse detaylı) tek kayıt. */
export function row(id: string, s: RowSpec): RecordView {
  const at = s.at ?? isoDaysAgo(1);
  const base = {
    year: s.year, km: s.km, price: s.price, currency: s.currency ?? 'TL', capturedAt: at,
    brand: 'Opel', series: 'Astra', model: '1.3 CDTI Enjoy', title: s.title ?? 'OPEL ASTRA 1.3 CDTI',
  };
  const obs = ob(s.price, at, {
    currency: s.currency ?? 'TL',
    ...(s.searchKey !== undefined ? { searchKey: s.searchKey } : {}),
    ...(s.filters ? { filters: s.filters } : {}),
  });
  const detailed = s.damage !== undefined || s.heavyDamage !== undefined || s.tramerAmount !== undefined || s.tramerStatus !== undefined;
  if (!detailed) return { id, best: summary(id, base), full: false, observations: [obs] };
  const l = listing(id, {
    ...base,
    damage: s.damage ?? null,
    heavyDamage: s.heavyDamage ?? null,
    tramerAmount: s.tramerAmount ?? null,
    ...(s.tramerStatus ? { tramerStatus: s.tramerStatus } : {}),
  });
  // Gerçekte arama filtresi kanıtı 'search' gözleminde durur; detay gözlemi ayrıdır (filtre taşımaz).
  if (s.filters) {
    const { filters: _f, ...listingObs } = obs;
    return { id, best: l, full: true, observations: [obs, { ...listingObs, kind: 'listing' }] };
  }
  return { id, best: l, full: true, observations: [{ ...obs, kind: 'listing' }] };
}

export const baseInput = (o: Partial<MarketInput> = {}): MarketInput => ({
  damagePolicy: 'match-target',
  maxAgeDays: 60,
  minSample: 8,
  adjust: 'auto',
  comparables: 10,
  ...o,
});

/** Ham gözlem: allOriginal = tüm parçalar orijinal (detay "hatasız"). */
export const ORIGINAL: NonNullable<Listing['damage']> = [
  { part: 'kaput', status: 'original' },
  { part: 'tavan', status: 'original' },
];
export const PAINTED: NonNullable<Listing['damage']> = [
  { part: 'kaput', status: 'painted' },
  { part: 'tavan', status: 'original' },
];
