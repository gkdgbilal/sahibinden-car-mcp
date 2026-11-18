import { foldTr } from './normalize.js';

/**
 * Canlı sitede (2026-11-19, gerçek tarayıcı oturumu) doğrulanmış marka/seri yolları:
 * /mercedes-benz, /mercedes-benz-c-serisi, /mercedes-benz-c-serisi-c-200-d (+ -c-200-d-bluetec, -c-200-cdi).
 * Mercedes dışındaki markalar için yol, "marka model" slug'ından türetilir (doğrulanmadı).
 */
const BRAND_ALIASES: Record<string, string> = {
  mercedes: 'mercedes-benz',
  'mercedes benz': 'mercedes-benz',
  'mercedes-benz': 'mercedes-benz',
  benz: 'mercedes-benz',
  'land rover': 'land-rover',
  landrover: 'land-rover',
  'land-rover': 'land-rover',
};

/** Marka adını sitedeki kanonik biçime çevirir (katlanmış, alias çözülmüş); bilinmeyen marka olduğu gibi döner. */
export function canonicalBrand(brand: string): string {
  const f = foldTr(brand).trim();
  return BRAND_ALIASES[f] ?? f.replace(/\s+/g, '-');
}

/** Mercedes harf+rakam model adını ("C200d", "c 200 d", "C 200 D BlueTEC") siteye uygun parçalara böler: "c 200 d bluetec". */
function splitMercedesModel(model: string): string {
  return foldTr(model)
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Marka + model için kategori yolu (başında "/" yok) ya da undefined (genel kural kullanılsın).
 * Mercedes A/B/C/E/S/R serisi: "C 200 d" -> mercedes-benz-c-serisi-c-200-d.
 */
export function brandModelPath(brand: string, model: string): string | undefined {
  if (canonicalBrand(brand) !== 'mercedes-benz') return undefined;
  const m = splitMercedesModel(model);
  const series = /^([abcesr]) \d/.exec(m);
  if (!series) return undefined;
  return `mercedes-benz-${series[1]}-serisi-${m.replace(/ /g, '-')}`;
}

/** Yerel mağaza eşleşmesi için boşluk/tire farklarını yok sayar: "C200d" ≈ "C 200 d". */
export const squash = (s: string) => foldTr(s).replace(/[\s-]+/g, '');

/**
 * SUV modelleri sitede "Arazi, SUV & Pickup" kategorisindedir (/arazi-suv-pickup-{marka}-{model}), otomobil
 * kategorisinde değildir; bu kategorinin filtre parametre kimlikleri de farklıdır (bkz. SUV_PARAMS).
 * Canlı sitede doğrulanan (2026-11-19): Land Rover model yolları.
 */
const LAND_ROVER_MODELS = [
  'range-rover-evoque', 'range-rover-sport', 'range-rover-velar', 'range-rover',
  'discovery-sport', 'discovery', 'defender', 'freelander',
];

export interface SuvTarget { path: string }

/** Marka+model doğrulanmış SUV kategorisindeyse yolunu döner (başında "/" yok); aksi halde undefined (otomobil kuralı). */
export function suvPath(brand: string | undefined, model: string | null): SuvTarget | undefined {
  let b = brand ? canonicalBrand(brand) : '';
  let m = model ? foldTr(model).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
  if (b === 'range-rover') { b = 'land-rover'; m = m.startsWith('range-rover') ? m : `range-rover${m ? `-${m}` : ''}`; }
  if (!b && m) {
    const hit = LAND_ROVER_MODELS.find((x) => m === x || m.startsWith(`${x}-`));
    if (hit) b = 'land-rover';
  }
  if (b !== 'land-rover') return undefined;
  if (!m) return { path: 'arazi-suv-pickup-land-rover' };
  // "Range Rover Discovery" gibi karışık yazım: Discovery'yi Land Rover modeli olarak al.
  const cleaned = m.replace(/^range-rover-(discovery|defender|freelander)/, '$1');
  const hit = LAND_ROVER_MODELS.find((x) => cleaned === x || cleaned.startsWith(`${x}-`));
  return hit ? { path: `arazi-suv-pickup-land-rover-${hit}` } : { path: 'arazi-suv-pickup-land-rover' };
}
