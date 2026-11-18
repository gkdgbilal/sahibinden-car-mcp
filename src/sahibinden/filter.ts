import { foldTr } from './normalize.js';
import type { Listing, ListingSummary, SearchQuery } from './types.js';

type Item = ListingSummary | Listing;
type FilterQuery = Partial<SearchQuery>;

export function matchesQuery(
  l: Item,
  q: FilterQuery,
): { match: boolean; unknownFields: string[] } {
  const unknown = new Set<string>();
  let ok = true;

  // Bilinmeyen (null) alan: includeUnknown'a göre karar verilir. Bilinen ve uyuşmayan alan her zaman eler.
  const range = (field: string, v: number | null, min?: number, max?: number) => {
    if (min === undefined && max === undefined) return;
    if (v === null) return void unknown.add(field);
    if ((min !== undefined && v < min) || (max !== undefined && v > max)) ok = false;
  };

  if (q.city) {
    if (!l.city) unknown.add('city');
    else if (foldTr(l.city) !== foldTr(q.city)) ok = false;
  }
  if (q.brand) {
    const b = foldTr(q.brand);
    if (l.brand) {
      if (foldTr(l.brand) !== b) ok = false;
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
    if (!hit) ok = false;
  }
  // Fiyat aralığı yalnızca TL ile karşılaştırılır; başka para birimi -> bilinmiyor.
  const priceComparable = l.currency === null || l.currency === 'TL' ? l.price : null;
  range('price', priceComparable, q.priceMin, q.priceMax);
  range('year', l.year, q.yearMin, q.yearMax);
  range('km', l.km, q.kmMin, q.kmMax);
  if (q.transmission) {
    if (!l.transmission) unknown.add('transmission');
    else if (l.transmission !== q.transmission) ok = false;
  }
  if (q.fuel) {
    if (!l.fuel) unknown.add('fuel');
    else if (l.fuel !== q.fuel) ok = false;
  }

  const unknownFields = [...unknown];
  const includeUnknown = q.includeUnknown ?? true;
  return { match: ok && (includeUnknown || unknownFields.length === 0), unknownFields };
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
