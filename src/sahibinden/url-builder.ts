import { canonicalBrand } from './brands.js';
import { resolveVehicle, type VehicleTarget } from './catalog.js';
import { foldTr } from './normalize.js';
import type { SearchQuery } from './types.js';
import {
  BASE, CATEGORY_LABELS, CATEGORY_PROFILES, HYBRID_VARIANT_IDS, LISTED_WITHIN_VALUES, PAGE_SIZE, PARAMS,
  PRICE_CURRENCY_IDS, SORTING_VALUES, resolveCity, type CategoryProfile,
} from './url-schema.js';

export interface SearchUrl {
  label: string;
  url: string;
  note?: string;
}

const TRANSMISSION_LABEL = { manual: 'Manuel', automatic: 'Otomatik', 'semi-automatic': 'Yarı Otomatik' } as const;

/** Kategori yolu için slug; "1.3" gibi motor hacmindeki nokta korunur (/opel-astra-1.3-cdti). */
export const slugify = (s: string) =>
  foldTr(s).replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');

/** Bir kategori için sorgu dizesi + o kategoride karşılığı olmayan/yaklaşık filtreler için notlar. */
function buildQuery(q: SearchQuery, profile: CategoryProfile): { query: string; notes: string[] } {
  const notes: string[] = [];
  const params = new URLSearchParams();
  const set = (key: string, v: string | number | undefined) => {
    if (v !== undefined) params.set(key, String(v));
  };
  const catLabel = CATEGORY_LABELS[profile.id];
  const missing = (what: string) =>
    notes.push(`${what} ${catLabel} kategorisinde yok ya da kimliği bilinmiyor; URL'ye eklenmedi (yerel filtre yine uygulanır).`);
  const k = profile.keys;

  set(PARAMS.priceMin.key, q.priceMin);
  set(PARAMS.priceMax.key, q.priceMax);
  if (q.priceCurrency) set(PARAMS.priceCurrency.key, PRICE_CURRENCY_IDS[q.priceCurrency]); // TL: parametre yok
  set(k.yearMin, q.yearMin);
  set(k.yearMax, q.yearMax);
  set(k.kmMin, q.kmMin);
  set(k.kmMax, q.kmMax);

  if (q.city) {
    const c = resolveCity(q.city);
    if (!c) {
      notes.push(`Şehir "${q.city}" tanınmadı; şehir filtresi URL'ye eklenmedi, sahibinden panelinden seçin.`);
    } else {
      set(PARAMS.city.key, c.code);
      if (!c.verified) {
        notes.push(
          `Şehir kodu (${c.name} = ${c.code}) doğrulanmadı (plaka kodu varsayımı); URL beklenen şehri göstermezse şehri panelden seçin.`,
        );
      }
    }
  }

  if (q.transmission) {
    const id = profile.transmission[q.transmission];
    if (id) set(k.transmission, id);
    else notes.push(`Vites (${TRANSMISSION_LABEL[q.transmission]}) için kimlik bilinmiyor; filtreyi sahibinden panelinden seçin.`);
  }
  if (q.fuel) {
    const id = profile.fuel[q.fuel];
    if (id) set(k.fuel, id);
    else missing(`Yakıt (${q.fuel})`);
    if (q.fuel === 'hybrid' && profile.id === 'otomobil') {
      const variants = Object.entries(HYBRID_VARIANT_IDS).map(([name, v]) => `${name}=${v}`).join(', ');
      notes.push(`Hibrit için Benzin(Hibrit) (a17=1312756) kullanıldı; diğer türler: ${variants}.`);
    } else if (q.fuel === 'hybrid' && id) {
      notes.push('Hibrit için "Benzin (Hibrit)" kimliği kullanıldı; Plug-in/Hafif Hibrit ve Dizel (Hafif Hibrit) ayrı seçeneklerdir, panelden eklenebilir.');
    }
  }
  if (q.sellerType) {
    const id = profile.sellerType[q.sellerType];
    if (id) set(k.sellerType, id); else missing(`Kimden (${q.sellerType})`);
  }
  if (q.color) {
    const id = profile.color[q.color];
    if (id) set(k.color, id); else missing(`Renk (${q.color})`);
  }
  if (q.vehicleCondition) {
    const id = profile.vehicleCondition?.[q.vehicleCondition];
    if (id && k.vehicleCondition) set(k.vehicleCondition, id); else missing('Araç durumu');
  }
  if (q.bodyType) {
    const id = profile.bodyType?.[q.bodyType];
    if (id && k.bodyType) set(k.bodyType, id); else missing(`Kasa tipi (${q.bodyType})`);
  }
  if (q.enginePower) {
    const id = profile.enginePower?.[q.enginePower];
    if (id && k.enginePower) {
      set(k.enginePower, id);
      if (Object.values(profile.enginePower ?? {}).filter((x) => x === id).length > 1 && profile.caveats?.enginePower) notes.push(profile.caveats.enginePower);
    } else missing('Motor gücü');
  }
  if (q.engineVolume) {
    const id = profile.engineVolume?.[q.engineVolume];
    if (id && k.engineVolume) {
      set(k.engineVolume, id);
      if (Object.values(profile.engineVolume ?? {}).filter((x) => x === id).length > 1 && profile.caveats?.engineVolume) notes.push(profile.caveats.engineVolume);
    } else missing('Motor hacmi');
  }
  if (q.drivetrain) {
    const id = profile.drivetrain[q.drivetrain];
    if (id) {
      set(k.drivetrain, id);
      if (q.drivetrain === 'awd' && profile.caveats?.drivetrain) notes.push(profile.caveats.drivetrain);
    } else missing(`Çekiş (${q.drivetrain})`);
  }
  if (q.exchange !== undefined) set(PARAMS.exchange.key, q.exchange ? 'yes' : 'no');
  if (q.listedWithin) set(PARAMS.listedWithin.key, LISTED_WITHIN_VALUES[q.listedWithin]);
  if (q.unpaintedOnly) set(PARAMS.unpainted.key, 'true');
  if (q.noReplacedParts) set(PARAMS.noReplacedParts.key, 'true');
  if (q.noHeavyDamage) set(k.heavyDamage, profile.heavyDamage.no);
  if (q.warranty !== undefined) {
    if (profile.warranty && k.warranty) set(k.warranty, q.warranty ? profile.warranty.yes : profile.warranty.no);
    else missing('Servis garantisi');
  }
  set(PARAMS.sorting.key, SORTING_VALUES[q.sort]);
  if (q.page && q.page > 1) set(PARAMS.pagingOffset.key, (q.page - 1) * PAGE_SIZE);

  return { query: params.toString(), notes };
}

/**
 * Arama sonuç sayfası URL'leri. Marka/model yolu sitenin kendi kategori ağacından toplanan katalogdan çözülür
 * (src/sahibinden/catalog.json); katalogda olmayan yol üretilmez, yakın seviyeye (seri/marka) düşülür ve not düşülür.
 * Bir model birden çok kategoride/yolda eşleşirse hepsi için URL döner. Saf; ağ isteği atmaz.
 */
export function buildSearchUrls(q: SearchQuery): SearchUrl[] {
  const models = q.models && q.models.length > 0 ? q.models : [null];
  const queries = new Map<string, ReturnType<typeof buildQuery>>();
  const queryFor = (profile: CategoryProfile) => {
    let r = queries.get(profile.id);
    if (!r) { r = buildQuery(q, profile); queries.set(profile.id, r); }
    return r;
  };

  const byUrl = new Map<string, SearchUrl>();
  const add = (path: string, label: string, profile: CategoryProfile, extra: string[]) => {
    const { query, notes } = queryFor(profile);
    if (q.city) label += ` - ${q.city}`;
    const url = `${BASE}${path}${query ? `?${query}` : ''}`;
    const allNotes = [...extra, ...notes];
    const prev = byUrl.get(url);
    if (prev) {
      prev.label += `, ${label}`;
      if (extra.length) prev.note = [prev.note, ...extra].filter(Boolean).join(' ');
      return;
    }
    byUrl.set(url, { label, url, ...(allNotes.length ? { note: allNotes.join(' ') } : {}) });
  };

  for (const model of models) {
    if (!q.brand && model === null) {
      add('/otomobil', 'Otomobil', CATEGORY_PROFILES.otomobil, []);
      continue;
    }
    const res = resolveVehicle(q.brand, model);
    if (res.targets.length > 0) {
      for (const t of res.targets as VehicleTarget[]) {
        const profile = CATEGORY_PROFILES[t.category];
        const prefix = t.category === 'otomobil' ? '' : `${CATEGORY_LABELS[t.category]}: `;
        add(`/${t.path}`, `${prefix}${t.label}`, profile, [...res.notes, ...t.notes]);
      }
      continue;
    }
    // Katalogda karşılık yok (marka bile): tahmin yürütme, genel sayfaya düş ya da (marka verilmişse) yolu tahmin et.
    const profile = CATEGORY_PROFILES.otomobil;
    if (q.brand && model) {
      const guess = slugify(`${canonicalBrand(q.brand)} ${model}`);
      add(`/${guess}`, `${q.brand} ${model}`, profile, [
        `"${q.brand}" markası sahibinden kataloğunda bulunamadı; yol tahmin edildi (/${guess}) ve doğrulanmadı. Sonuç boşsa markayı/modeli panelden seçin.`,
      ]);
    } else if (q.brand) {
      const guess = slugify(canonicalBrand(q.brand));
      add(`/${guess}`, q.brand, profile, [
        `"${q.brand}" markası sahibinden kataloğunda bulunamadı; yol tahmin edildi (/${guess}) ve doğrulanmadı.`,
      ]);
    } else {
      add('/otomobil', model ?? 'Otomobil', profile, [
        ...res.notes,
        `"${model}" için marka bilinmiyor; genel otomobil sayfası kullanıldı, modeli panelden seçin.`,
      ]);
    }
  }
  return [...byUrl.values()];
}
