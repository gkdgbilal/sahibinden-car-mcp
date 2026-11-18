import { describe, expect, it } from 'vitest';
import { matchesQuery, sortListings } from '../src/sahibinden/filter.js';
import { SearchQuerySchema, type ListingSummary } from '../src/sahibinden/types.js';

const q = (o: object) => SearchQuerySchema.parse(o);
const mk = (o: Partial<ListingSummary> = {}): ListingSummary => ({
  id: '1000000001', url: 'https://www.sahibinden.com/ilan/x-1000000001/detay', title: 'Temiz Golf',
  brand: 'Volkswagen', series: 'Golf', model: '1.6 TDi', year: 2016, km: 100000, color: null,
  price: 800000, currency: 'TL', city: 'Samsun', district: null, listingDate: '2026-11-18',
  transmission: null, fuel: null, source: 'search', capturedAt: '2026-11-18T00:00:00.000Z', ...o,
});

describe('matchesQuery', () => {
  it('null alan includeUnknown ile eşleşir ve işaretlenir', () => {
    const r = matchesQuery(mk(), q({ transmission: 'automatic', priceMax: 900000 }));
    expect(r).toEqual({ match: true, unknownFields: ['transmission'] });
  });
  it('includeUnknown=false bilinmeyeni eler', () => {
    expect(matchesQuery(mk(), q({ transmission: 'automatic', includeUnknown: false })).match).toBe(false);
  });
  it('bilinen alan uyuşmazsa her zaman eler', () => {
    expect(matchesQuery(mk(), q({ priceMax: 700000 })).match).toBe(false);
    expect(matchesQuery(mk({ transmission: 'manual' }), q({ transmission: 'automatic' })).match).toBe(false);
    expect(matchesQuery(mk(), q({ yearMin: 2018 })).match).toBe(false);
    expect(matchesQuery(mk(), q({ kmMax: 50000 })).match).toBe(false);
  });
  it('Türkçe karakterli şehir', () => {
    expect(matchesQuery(mk({ city: 'İzmir' }), q({ city: 'izmir' })).match).toBe(true);
    expect(matchesQuery(mk({ city: 'izmir' }), q({ city: 'İzmir' })).match).toBe(true);
    expect(matchesQuery(mk({ city: 'Samsun' }), q({ city: 'İzmir' })).match).toBe(false);
  });
  it('models series/model/title içinde aranır', () => {
    expect(matchesQuery(mk(), q({ models: ['Astra', 'golf'] })).match).toBe(true);
    expect(matchesQuery(mk(), q({ models: ['Astra'] })).match).toBe(false);
    expect(matchesQuery(mk({ series: null, model: null, title: 'Sahibinden Astra 1.4' }), q({ models: ['astra'] })).match).toBe(true);
  });
  it('brand null ise başlığa bakar, yoksa bilinmiyor', () => {
    expect(matchesQuery(mk({ brand: null, title: 'Volkswagen Golf' }), q({ brand: 'volkswagen' }))).toEqual({ match: true, unknownFields: [] });
    expect(matchesQuery(mk({ brand: null }), q({ brand: 'Opel' })).unknownFields).toEqual(['brand']);
    expect(matchesQuery(mk(), q({ brand: 'Opel' })).match).toBe(false);
  });
  it('TL dışı fiyat karşılaştırılmaz', () => {
    expect(matchesQuery(mk({ currency: 'EUR', price: 20000 }), q({ priceMin: 700000 })).unknownFields).toEqual(['price']);
  });
});

describe('sortListings', () => {
  const a = mk({ id: 'a', price: 300, year: 2010, km: 5, listingDate: '2026-01-01' });
  const b = mk({ id: 'b', price: null, year: null, km: null, listingDate: null });
  const c = mk({ id: 'c', price: 100, year: 2020, km: 50, listingDate: '2026-05-01' });
  const ids = (l: ListingSummary[]) => l.map((x) => x.id);
  it('null değerler sona', () => {
    expect(ids(sortListings([b, a, c], 'price_asc'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortListings([b, a, c], 'price_desc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortListings([b, a, c], 'year_desc'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortListings([b, a, c], 'km_asc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortListings([b, a, c], 'date_desc'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortListings([b, a, c], 'year_asc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortListings([b, a, c], 'km_desc'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortListings([b, a, c], 'date_asc'))).toEqual(['a', 'c', 'b']);
  });
  it('girdiyi değiştirmez', () => {
    const input = [b, a, c];
    sortListings(input, 'price_asc');
    expect(ids(input)).toEqual(['b', 'a', 'c']);
  });
});
