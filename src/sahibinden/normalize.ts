import type { Currency, Fuel, SellerType, Transmission } from './types.js';

/** Türkçe-duyarsız karşılaştırma anahtarı: küçük harf, diakritiksiz, tek boşluk. */
export function foldTr(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/é/g, 'e')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "875.000 TL" -> 875000; nokta binlik, virgül ondalık. Sayı yoksa null. */
export function parseTrNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/\d[\d.]*(?:,\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseCurrency(raw: string | null | undefined): Currency | null {
  if (!raw) return null;
  const s = raw.toUpperCase();
  if (s.includes('TL') || s.includes('₺') || s.includes('TRY')) return 'TL';
  if (s.includes('USD') || s.includes('$')) return 'USD';
  if (s.includes('EUR') || s.includes('€')) return 'EUR';
  return null;
}

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
  temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "18 Kasım 2026" | "18.11.2026" -> "2026-11-18" */
export function parseTrDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = foldTr(raw);
  const dotted = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dotted) return validDate(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));
  const named = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (named) {
    const month = MONTHS[named[2]!];
    if (month) return validDate(Number(named[3]), month, Number(named[1]));
  }
  return null;
}

export function mapTransmission(raw: string | null | undefined): Transmission | null {
  const s = foldTr(raw);
  if (!s) return null;
  if (s.includes('yari')) return 'semi-automatic';
  if (s.includes('otomatik')) return 'automatic';
  if (s.includes('manuel')) return 'manual';
  return null;
}

export function mapFuel(raw: string | null | undefined): Fuel | null {
  const s = foldTr(raw);
  if (!s) return null;
  if (s.includes('lpg')) return 'lpg';
  if (s.includes('hibrit') || s.includes('hybrid')) return 'hybrid';
  if (s.includes('elektrik')) return 'electric';
  if (s.includes('dizel')) return 'diesel';
  if (s.includes('benzin')) return 'gasoline';
  return null;
}

export function mapSellerType(raw: string | null | undefined): SellerType | null {
  const s = foldTr(raw);
  if (!s) return null;
  if (s.includes('yetkili')) return 'authorized-dealer';
  if (s.includes('galeri')) return 'dealer';
  if (s.includes('sahibinden')) return 'owner';
  return null;
}

export function parseYesNo(raw: string | null | undefined): boolean | null {
  const s = foldTr(raw);
  if (s === 'evet') return true;
  if (s === 'hayir') return false;
  return null;
}

/** "1598 cm3" -> 1598, "110 hp" -> 110, "1401 - 1600 cm3" (aralık) -> null. */
export function parseRangeOrNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  if (/\d\s*[-–]\s*\d/.test(raw)) return null;
  return parseTrNumber(raw);
}
