import type { Fuel, Transmission } from './types.js';

// Tüm URL sabitleri burada. `verified:false` = canlı sitede doğrulanmadı (bkz. docs/01-ANALYSIS.md §4).
// Kullanıcı gerçek bir filtreli URL verdiğinde yalnızca bu dosya güncellenir.
export const BASE = 'https://www.sahibinden.com';

export const PARAMS = {
  priceMin: { key: 'price_min', verified: false },
  priceMax: { key: 'price_max', verified: false },
  yearMin: { key: 'a5_min', verified: false },
  yearMax: { key: 'a5_max', verified: false },
  kmMin: { key: 'a4_min', verified: false },
  kmMax: { key: 'a4_max', verified: false },
  sorting: { key: 'sorting', verified: false },
  pagingSize: { key: 'pagingSize', verified: false },
} as const;

// Vites/yakıt değer ID'leri bilinmiyor -> boş; URL'e eklenmez, kullanıcıya not düşülür.
export const TRANSMISSION_IDS: Partial<Record<Transmission, string>> = {};
export const FUEL_IDS: Partial<Record<Fuel, string>> = {};

export const CITY_MODE: 'path' | 'query' = 'path'; // doğrulanmadı

export const LISTING_URL = (id: string) => `${BASE}/ilan/${id}/detay`; // fallback; gerçek slug'lı URL tercih
