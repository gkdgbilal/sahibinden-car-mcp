import type { Listing, ListingSummary } from '../../src/sahibinden/types.js';
import type { InsightStore, Observation, RecordView, SearchInfo, WatchItem } from '../../src/store/schema.js';

/** Sabit "şimdi" (testlerde saat enjekte edilir). */
export const NOW = new Date('2026-11-18T12:00:00.000Z');

export const summary = (id: string, o: Partial<ListingSummary> = {}): ListingSummary => ({
  id,
  url: `https://www.sahibinden.com/ilan/vasita-otomobil-ornek-${id}/detay`,
  title: `ORNEK ARAC ${id}`,
  brand: null, series: null, model: null, year: 2011, km: 176000, color: null,
  price: null, currency: 'TL', city: 'Samsun', district: null, listingDate: null,
  transmission: null, fuel: null, source: 'search', capturedAt: '2026-11-18T12:00:00.000Z', ...o,
});

export const listing = (id: string, o: Partial<Listing> = {}): Listing => ({
  ...summary(id, { source: 'listing' }),
  engine: null, bodyType: null, drivetrain: null, vehicleCondition: null, sellerType: null,
  exchange: null, warranty: null, heavyDamage: null, tramerAmount: null, damage: null, description: null,
  attributes: {}, warnings: [], ...o,
});

export const ob = (price: number | null, at: string, o: Partial<Observation> = {}): Observation => ({
  at: at.length === 10 ? `${at}T12:00:00.000Z` : at,
  kind: 'search',
  price,
  currency: 'TL',
  ...o,
});

export const view = (
  id: string,
  obs: Observation[],
  best: Partial<ListingSummary> = {},
): RecordView => ({ id, best: summary(id, best), full: false, observations: obs });

export const searchInfo = (o: Partial<SearchInfo> = {}): SearchInfo => ({
  path: '/opel-astra-1.3-cdti',
  category: 'opel-astra-1.3-cdti',
  filters: [],
  sorting: null,
  filtersKnown: true,
  firstObservedAt: '2026-10-01T12:00:00.000Z',
  lastObservedAt: '2026-11-15T12:00:00.000Z',
  totalCount: null,
  ...o,
});

/** Bellek içi InsightStore (dosya yok). */
export function memStore(
  views: RecordView[],
  searches: Record<string, SearchInfo> = {},
  watch: Record<string, WatchItem> = {},
): InsightStore {
  return {
    records: () => views,
    record: (id) => views.find((v) => v.id === id),
    searches: () => searches,
    watchlist: () => watch,
    watchUpsert: (id, patch, at) => (watch[id] = { priceAtAdd: null, currencyAtAdd: null, addedAt: at, updatedAt: at, ...patch }),
    watchRemove: (id) => delete watch[id],
    save: () => undefined,
  };
}
