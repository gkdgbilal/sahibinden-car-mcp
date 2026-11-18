import { foldTr } from './normalize.js';
import type { BodyType, Color, Listing, ListingSummary, SearchQuery, UnknownPolicy, VehicleCondition } from './types.js';
import { ENGINE_POWER_RANGES, ENGINE_VOLUME_RANGES, LISTED_WITHIN_DAYS, type NumericRange } from './url-schema.js';

type Item = ListingSummary | Listing;
type FilterQuery = Partial<SearchQuery>;

export interface MatchOptions {
  /** listedWithin için "şimdi"; testte sabitlenir. Varsayılan: Date.now(). */
  now?: Date;
}

export interface Evaluation {
  match: boolean;
  unknownFields: string[];
  /** Başka her kural geçti, yalnızca para birimi fiyat filtresiyle uyuşmadı. */
  excludedOtherCurrency: boolean;
  /** Başka her kural geçti, yalnızca bilinmeyen alan ('exclude' politikası) yüzünden elendi. */
  excludedUnknown: boolean;
}

// Sahibinden etiketleri (foldTr ile katlanmış) -> filtre değeri. Dolu ama listede olmayan etiket (ör. Siyah) hiçbir renk filtresine uymaz.
const COLOR_LABELS: Record<Color, string[]> = {
  beige: ['bej'], white: ['beyaz'], burgundy: ['bordo'], 'smoke-gray': ['fume'], gray: ['gri'],
  'silver-gray': ['gumus gri', 'gumus'], brown: ['kahverengi'], red: ['kirmizi'], navy: ['lacivert'],
  blue: ['mavi'], purple: ['mor'], pink: ['pembe'],
};
const BODY_LABELS: Record<BodyType, string[]> = {
  cabrio: ['cabrio', 'cabriolet'], coupe: ['coupe'], 'coupe-4-door': ['coupe 4 kapi'],
  'hatchback-3-door': ['hatchback 3 kapi'], 'hatchback-5-door': ['hatchback 5 kapi'], sedan: ['sedan'],
  'station-wagon': ['station wagon', 'stationwagon'], mpv: ['mpv', 'minivan'], roadster: ['roadster'],
};

function drivetrainOf(raw: string | null | undefined): SearchQuery['drivetrain'] | null {
  const f = foldTr(raw);
  if (!f) return null;
  if (f.includes('onden')) return 'fwd';
  if (f.includes('arkadan')) return 'rwd';
  if (f.includes('4wd') || f.includes('4x4')) return '4wd';
  if (f.includes('awd')) return 'awd';
  return null;
}

function conditionOf(raw: string | null | undefined): VehicleCondition | null {
  const f = foldTr(raw);
  if (!f) return null;
  if (f.includes('ithal')) return 'imported-new';
  if (f.includes('ikinci el')) return 'second-hand';
  if (f.includes('sifir')) return 'new';
  return null;
}

/** Aralık (lo, hi]. */
const inRange = (v: number, r: NumericRange) => v > r.lo && v <= r.hi;

const DAY_MS = 86_400_000;
/** "YYYY-MM-DD" ile now (UTC günü) arasındaki tam gün farkı; ayrıştırılamazsa null. */
function daysSince(date: string | null, now: Date): number | null {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const listed = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - listed) / DAY_MS);
}

/** unknown öncelikli; verilmediyse eski includeUnknown; ikisi de yoksa 'include'. */
export function unknownPolicyOf(q: FilterQuery): UnknownPolicy {
  return q.unknown ?? (q.includeUnknown === false ? 'exclude' : 'include');
}

/** Yerelde uygulanan filtre adları (page/sort/limit/unknown filtre değildir). */
export function appliedFilterNames(q: FilterQuery): string[] {
  const names: string[] = [];
  for (const k of [
    'city', 'brand', 'models', 'priceMin', 'priceMax', 'priceCurrency', 'transmission', 'fuel', 'yearMin', 'yearMax',
    'kmMin', 'kmMax', 'sellerType', 'bodyType', 'color', 'vehicleCondition', 'enginePower', 'engineVolume',
    'drivetrain', 'exchange', 'listedWithin', 'unpaintedOnly', 'noReplacedParts', 'noHeavyDamage', 'warranty',
  ] as const) {
    const v = q[k];
    if (v === undefined) continue;
    // exchange/warranty=false gerçek bir filtredir; "yalnızca ..." bayrakları false iken filtre değildir.
    if (v === false && k !== 'exchange' && k !== 'warranty') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    names.push(k);
  }
  return names;
}

/**
 * Tüm filtreleri değerlendirir. Detay alanları (bodyType, damage, ...) yalnızca Listing'de bulunur;
 * özet kaydında bu alanlar yoktur ve "bilinmiyor" sayılır. Bilinen ve uyuşmayan alan her zaman eler.
 */
export function evaluateQuery(l: Item, q: FilterQuery, opts: MatchOptions = {}): Evaluation {
  const unknown = new Set<string>();
  let hardFail = false;
  let currencyFail = false;
  const d = l as Partial<Listing>;

  const range = (field: string, v: number | null, min?: number, max?: number) => {
    if (min === undefined && max === undefined) return;
    if (v === null) return void unknown.add(field);
    if ((min !== undefined && v < min) || (max !== undefined && v > max)) hardFail = true;
  };
  /** Bilinen değer beklenenle eşit olmalı; null/undefined/tanınmayan -> bilinmiyor. */
  const equals = <T>(field: string, actual: T | null | undefined, expected: T) => {
    if (actual === null || actual === undefined) return void unknown.add(field);
    if (actual !== expected) hardFail = true;
  };

  if (q.city) {
    if (!l.city) unknown.add('city');
    else if (foldTr(l.city) !== foldTr(q.city)) hardFail = true;
  }
  if (q.brand) {
    const b = foldTr(q.brand);
    if (l.brand) {
      if (foldTr(l.brand) !== b) hardFail = true;
    } else if (!foldTr(l.title).includes(b)) {
      unknown.add('brand'); // arama satırında marka sütunu yok; başlıkta da geçmiyor
    }
  }
  if (q.models && q.models.length > 0) {
    const hay = [l.series, l.model, l.title].map((s) => foldTr(s));
    const hit = q.models.some((m) => {
      const f = foldTr(m);
      return f !== '' && hay.some((h) => h.includes(f));
    });
    if (!hit) hardFail = true;
  }

  // Fiyat: priceMin/priceMax priceCurrency (varsayılan TL) cinsindendir; dönüşüm yok. Para birimi boşsa TL varsayılır.
  if (q.priceMin !== undefined || q.priceMax !== undefined) {
    const want = q.priceCurrency ?? 'TL';
    const have = l.currency ?? 'TL';
    if (l.price !== null && have !== want) currencyFail = true;
    else range('price', l.price, q.priceMin, q.priceMax);
  }
  range('year', l.year, q.yearMin, q.yearMax);
  range('km', l.km, q.kmMin, q.kmMax);

  if (q.transmission) equals('transmission', l.transmission, q.transmission);
  if (q.fuel) equals('fuel', l.fuel, q.fuel);
  // Metin alanları: boşsa bilinmiyor; dolu ama istenen değer değilse (filtrede olmayan bir değer dahil) elenir.
  const text = (field: string, raw: string | null | undefined, ok: boolean) => {
    if (!foldTr(raw)) unknown.add(field);
    else if (!ok) hardFail = true;
  };
  if (q.color) text('color', l.color, COLOR_LABELS[q.color].includes(foldTr(l.color)));
  if (q.bodyType) text('bodyType', d.bodyType, BODY_LABELS[q.bodyType].includes(foldTr(d.bodyType)));
  if (q.drivetrain) text('drivetrain', d.drivetrain, drivetrainOf(d.drivetrain) === q.drivetrain);
  if (q.vehicleCondition) text('vehicleCondition', d.vehicleCondition, conditionOf(d.vehicleCondition) === q.vehicleCondition);
  if (q.sellerType) equals('sellerType', d.sellerType, q.sellerType);
  if (q.exchange !== undefined) equals('exchange', d.exchange, q.exchange);
  if (q.warranty !== undefined) equals('warranty', d.warranty, q.warranty);
  if (q.noHeavyDamage) equals('noHeavyDamage', d.heavyDamage, false);

  if (q.enginePower) {
    const v = d.engine?.powerHp ?? null;
    if (v === null) unknown.add('enginePower');
    else if (!inRange(v, ENGINE_POWER_RANGES[q.enginePower])) hardFail = true;
  }
  if (q.engineVolume) {
    const v = d.engine?.volumeCc ?? null;
    if (v === null) unknown.add('engineVolume');
    else if (!inRange(v, ENGINE_VOLUME_RANGES[q.engineVolume])) hardFail = true;
  }

  if (q.listedWithin) {
    const age = daysSince(l.listingDate, opts.now ?? new Date());
    if (age === null) unknown.add('listedWithin');
    else if (age > LISTED_WITHIN_DAYS[q.listedWithin]) hardFail = true;
  }

  // Hasar verisi yoksa (null/boş) bilinmiyor; boyalı = painted + local-painted.
  const damage = d.damage && d.damage.length > 0 ? d.damage : null;
  if (q.unpaintedOnly) {
    if (!damage) unknown.add('unpaintedOnly');
    else if (damage.some((p) => p.status === 'painted' || p.status === 'local-painted')) hardFail = true;
  }
  if (q.noReplacedParts) {
    if (!damage) unknown.add('noReplacedParts');
    else if (damage.some((p) => p.status === 'changed')) hardFail = true;
  }

  const unknownFields = [...unknown];
  const exclude = unknownPolicyOf(q) === 'exclude';
  const passes = !hardFail && !currencyFail;
  const excludedUnknown = passes && exclude && unknownFields.length > 0;
  return {
    match: passes && !excludedUnknown,
    unknownFields,
    excludedOtherCurrency: !hardFail && currencyFail,
    excludedUnknown,
  };
}

export function matchesQuery(
  l: Item,
  q: FilterQuery,
  opts: MatchOptions = {},
): { match: boolean; unknownFields: string[] } {
  const { match, unknownFields } = evaluateQuery(l, q, opts);
  return { match, unknownFields };
}

const nullLast = (a: number | string | null, b: number | string | null, dir: 1 | -1): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a === b ? 0 : (a < b ? -1 : 1) * dir;
};

export function sortListings<T extends Item>(list: T[], sort: SearchQuery['sort']): T[] {
  const cmp: Record<SearchQuery['sort'], (a: T, b: T) => number> = {
    price_asc: (a, b) => nullLast(a.price, b.price, 1),
    price_desc: (a, b) => nullLast(a.price, b.price, -1),
    year_desc: (a, b) => nullLast(a.year, b.year, -1),
    year_asc: (a, b) => nullLast(a.year, b.year, 1),
    km_asc: (a, b) => nullLast(a.km, b.km, 1),
    km_desc: (a, b) => nullLast(a.km, b.km, -1),
    date_desc: (a, b) => nullLast(a.listingDate, b.listingDate, -1),
    date_asc: (a, b) => nullLast(a.listingDate, b.listingDate, 1),
  };
  return [...list].sort(cmp[sort]);
}
