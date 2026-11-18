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
