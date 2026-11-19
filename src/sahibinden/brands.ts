import { foldTr } from './normalize.js';

/**
 * Marka adı kısaltmaları (yerel mağaza filtresi için). Marka/seri/motor YOLLARI artık burada değil, sitenin kendi
 * kategori ağacından toplanan katalogda (catalog.ts, catalog.json) çözülür.
 */
const BRAND_ALIASES: Record<string, string> = {
  mercedes: 'mercedes-benz',
  'mercedes benz': 'mercedes-benz',
  'mercedes-benz': 'mercedes-benz',
  benz: 'mercedes-benz',
  'land rover': 'land-rover',
  landrover: 'land-rover',
  'land-rover': 'land-rover',
  vw: 'volkswagen',
  tofas: 'tofas',
  chevy: 'chevrolet',
};

/** Marka adını sitedeki kanonik biçime çevirir (katlanmış, alias çözülmüş); bilinmeyen marka olduğu gibi döner. */
export function canonicalBrand(brand: string): string {
  const f = foldTr(brand).trim();
  return BRAND_ALIASES[f] ?? f.replace(/\s+/g, '-');
}

/** Yerel mağaza eşleşmesi için boşluk/tire farklarını yok sayar: "C200d" ≈ "C 200 d". */
export const squash = (s: string) => foldTr(s).replace(/[\s-]+/g, '');
