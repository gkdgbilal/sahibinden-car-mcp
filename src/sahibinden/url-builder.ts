import { brandModelPath, canonicalBrand } from './brands.js';
import { foldTr } from './normalize.js';
import type { SearchQuery } from './types.js';
import {
  BASE, BODY_TYPE_IDS, COLOR_IDS, DRIVETRAIN_IDS, ENGINE_POWER_IDS, ENGINE_VOLUME_IDS, FUEL_IDS,
  HEAVY_DAMAGE_IDS, HYBRID_VARIANT_IDS, WARRANTY_IDS, LISTED_WITHIN_VALUES, PAGE_SIZE, PARAMS, PRICE_CURRENCY_IDS, SELLER_TYPE_IDS,
  SORTING_VALUES, TRANSMISSION_IDS, VEHICLE_CONDITION_IDS, resolveCity,
} from './url-schema.js';

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

const TRANSMISSION_LABEL = { manual: 'Manuel', automatic: 'Otomatik', 'semi-automatic': 'Yarı Otomatik' } as const;

/** Kategori yolu için slug; "1.3" gibi motor hacmindeki nokta korunur (/opel-astra-1.3-cdti). */
export const slugify = (s: string) =>
  foldTr(s).replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');

/** Arama sonuç sayfası URL'leri (model başına bir tane). Saf; ağ isteği atmaz. */
export function buildSearchUrls(q: SearchQuery): SearchUrl[] {
  const brandSlug = q.brand ? canonicalBrand(q.brand) : '';
  const models = q.models && q.models.length > 0 ? q.models : [null];

  const notes: string[] = [];
  const params = new URLSearchParams();
  const set = (p: { key: string }, v: string | number | undefined) => {
    if (v !== undefined) params.set(p.key, String(v));
  };

  set(PARAMS.priceMin, q.priceMin);
  set(PARAMS.priceMax, q.priceMax);
  if (q.priceCurrency) set(PARAMS.priceCurrency, PRICE_CURRENCY_IDS[q.priceCurrency]); // TL: parametre yok
  set(PARAMS.yearMin, q.yearMin);
  set(PARAMS.yearMax, q.yearMax);
  set(PARAMS.kmMin, q.kmMin);
  set(PARAMS.kmMax, q.kmMax);

  if (q.city) {
    const c = resolveCity(q.city);
    if (!c) {
      notes.push(`Şehir "${q.city}" tanınmadı; şehir filtresi URL'ye eklenmedi, sahibinden panelinden seçin.`);
    } else {
      set(PARAMS.city, c.code);
      if (!c.verified) {
        notes.push(
          `Şehir kodu (${c.name} = ${c.code}) doğrulanmadı (plaka kodu varsayımı); yalnızca Samsun (55) ve İstanbul (34) doğrulandı. ` +
            'URL beklenen şehri göstermezse şehri panelden seçin.',
        );
      }
    }
  }

  if (q.transmission) {
    const id = TRANSMISSION_IDS[q.transmission];
    if (id) set(PARAMS.transmission, id);
    else notes.push(`Vites (${TRANSMISSION_LABEL[q.transmission]}) için kimlik bilinmiyor; filtreyi sahibinden panelinden seçin.`);
  }
  if (q.fuel) {
    set(PARAMS.fuel, FUEL_IDS[q.fuel]);
    if (q.fuel === 'hybrid') {
      const variants = Object.entries(HYBRID_VARIANT_IDS).map(([k, v]) => `${k}=${v}`).join(', ');
      notes.push(`Hibrit için Benzin(Hibrit) (a17=1312756) kullanıldı; diğer türler: ${variants}.`);
    }
  }
  if (q.sellerType) set(PARAMS.sellerType, SELLER_TYPE_IDS[q.sellerType]);
  if (q.bodyType) set(PARAMS.bodyType, BODY_TYPE_IDS[q.bodyType]);
  if (q.color) set(PARAMS.color, COLOR_IDS[q.color]);
  if (q.vehicleCondition) set(PARAMS.vehicleCondition, VEHICLE_CONDITION_IDS[q.vehicleCondition]);
  if (q.enginePower) set(PARAMS.enginePower, ENGINE_POWER_IDS[q.enginePower]);
  if (q.engineVolume) set(PARAMS.engineVolume, ENGINE_VOLUME_IDS[q.engineVolume]);
  if (q.drivetrain) set(PARAMS.drivetrain, DRIVETRAIN_IDS[q.drivetrain]);
  if (q.exchange !== undefined) set(PARAMS.exchange, q.exchange ? 'yes' : 'no');
  if (q.listedWithin) set(PARAMS.listedWithin, LISTED_WITHIN_VALUES[q.listedWithin]);
  if (q.unpaintedOnly) set(PARAMS.unpainted, 'true');
  if (q.noReplacedParts) set(PARAMS.noReplacedParts, 'true');
  if (q.noHeavyDamage) set(PARAMS.heavyDamage, HEAVY_DAMAGE_IDS.no);
  if (q.warranty !== undefined) set(PARAMS.warranty, q.warranty ? WARRANTY_IDS.yes : WARRANTY_IDS.no);
  set(PARAMS.sorting, SORTING_VALUES[q.sort]);
  if (q.page && q.page > 1) set(PARAMS.pagingOffset, (q.page - 1) * PAGE_SIZE);

  const query = params.toString();

  const byUrl = new Map<string, SearchUrl>();
  for (const model of models) {
    const extra: string[] = [];
    let path: string;
    let label: string;
    if (model === null) {
      path = brandSlug ? `/${brandSlug}` : '/otomobil';
      label = q.brand ?? 'Otomobil';
    } else {
      const firstWord = foldTr(model).split(' ')[0] ?? '';
      const brand = brandSlug || BRAND_OF_MODEL[firstWord] || '';
      if (brand) {
        path = `/${brandModelPath(brand, model) ?? slugify(`${brand} ${model}`)}`;
        label = `${q.brand ?? brand} ${model}`;
      } else {
        path = '/otomobil';
        label = model;
        extra.push(`"${model}" için marka bilinmiyor; genel otomobil sayfası kullanıldı, modeli panelden seçin.`);
      }
    }
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
