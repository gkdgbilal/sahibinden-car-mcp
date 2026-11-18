import { foldTr } from './normalize.js';
import type { SearchQuery } from './types.js';
import { BASE, CITY_MODE, FUEL_IDS, PARAMS, TRANSMISSION_IDS } from './url-schema.js';

export interface SearchUrl {
  label: string;
  url: string;
  note?: string;
}

const BRAND_OF_MODEL: Record<string, string> = {
  golf: 'volkswagen', astra: 'opel', focus: 'ford', megane: 'renault', corolla: 'toyota',
  civic: 'honda', egea: 'fiat', clio: 'renault', i20: 'hyundai', passat: 'volkswagen',
  polo: 'volkswagen', octavia: 'skoda', '320': 'bmw',
};

const SORTING: Partial<Record<SearchQuery['sort'], string>> = {
  price_asc: 'price_asc',
  price_desc: 'price_desc',
  date_desc: 'date_desc',
};

const TRANSMISSION_LABEL = { manual: 'Manuel', automatic: 'Otomatik', 'semi-automatic': 'Yarı Otomatik' } as const;
const FUEL_LABEL = { gasoline: 'Benzin', diesel: 'Dizel', lpg: 'LPG', hybrid: 'Hibrit', electric: 'Elektrik' } as const;

const slugify = (s: string) =>
  foldTr(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Arama sonuç sayfası URL'leri (model başına bir tane). Saf; ağ isteği atmaz. */
export function buildSearchUrls(q: SearchQuery): SearchUrl[] {
  const brandSlug = q.brand ? slugify(q.brand) : '';
  const models = q.models && q.models.length > 0 ? q.models : [null];

  const notes: string[] = [];
  const params = new URLSearchParams();
  const num = (p: { key: string }, v: number | undefined) => {
    if (v !== undefined) params.set(p.key, String(v));
  };
  num(PARAMS.priceMin, q.priceMin);
  num(PARAMS.priceMax, q.priceMax);
  num(PARAMS.yearMin, q.yearMin);
  num(PARAMS.yearMax, q.yearMax);
  num(PARAMS.kmMin, q.kmMin);
  num(PARAMS.kmMax, q.kmMax);
  const sorting = SORTING[q.sort];
  if (sorting) params.set(PARAMS.sorting.key, sorting);

  // Vites/yakıt: ID bilinmiyorsa URL'e eklenmez.
  if (q.transmission && !TRANSMISSION_IDS[q.transmission]) {
    notes.push(`Vites (${TRANSMISSION_LABEL[q.transmission]}) filtresini sahibinden panelinden seçin.`);
  }
  if (q.fuel && !FUEL_IDS[q.fuel]) {
    notes.push(`Yakıt (${FUEL_LABEL[q.fuel]}) filtresini sahibinden panelinden seçin.`);
  }
  if (!Object.values(PARAMS).some((p) => p.verified)) notes.push('URL şeması doğrulanmadı.');

  const citySlug = q.city ? slugify(q.city) : '';
  if (citySlug && CITY_MODE === 'query') params.set('address_city', citySlug);
  const query = params.toString();

  const byUrl = new Map<string, SearchUrl>();
  for (const model of models) {
    const extra: string[] = [];
    let path: string;
    let label: string;
    if (model === null) {
      path = brandSlug ? `/otomobil/${brandSlug}` : '/otomobil';
      label = q.brand ?? 'Otomobil';
    } else {
      const brand = brandSlug || BRAND_OF_MODEL[foldTr(model)] || '';
      if (brand) {
        path = `/${slugify(`${brand} ${model}`)}`;
        label = `${q.brand ?? brand} ${model}`;
      } else {
        path = '/otomobil';
        label = model;
        extra.push(`"${model}" için marka bilinmiyor; genel otomobil sayfası kullanıldı, modeli panelden seçin.`);
      }
    }
    if (citySlug && CITY_MODE === 'path') path += `/${citySlug}`;
    if (q.city) label += ` - ${q.city}`;

    const url = `${BASE}${path}${query ? `?${query}` : ''}`;
    const allNotes = [...extra, ...notes];
    const prev = byUrl.get(url);
    if (prev) {
      prev.label += `, ${label}`;
      if (extra.length) prev.note = [prev.note, ...extra].filter(Boolean).join(' ');
      continue;
    }
    byUrl.set(url, { label, url, ...(allNotes.length ? { note: allNotes.join(' ') } : {}) });
  }
  return [...byUrl.values()];
}
