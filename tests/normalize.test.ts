import { describe, expect, it } from 'vitest';
import {
  foldTr, mapFuel, mapSellerType, mapTransmission, parseCurrency,
  parseRangeOrNumber, parseTrDate, parseTrNumber, parseYesNo,
} from '../src/sahibinden/normalize.js';

describe('foldTr', () => {
  it('Türkçe karakterleri katlar', () => {
    expect(foldTr('İzmir')).toBe('izmir');
    expect(foldTr('ÇANKIRI Şişli Öğüt Ğ')).toBe('cankiri sisli ogut g');
  });
  it('boşlukları sadeleştirir', () => {
    expect(foldTr('  il   /  ilçe ')).toBe('il / ilce');
  });
  it('boş / null', () => {
    expect(foldTr('')).toBe('');
    expect(foldTr(null)).toBe('');
  });
});

describe('parseTrNumber', () => {
  it('binlik nokta', () => {
    expect(parseTrNumber('875.000 TL')).toBe(875000);
    expect(parseTrNumber('1.250.000')).toBe(1250000);
    expect(parseTrNumber('125.000 km')).toBe(125000);
  });
  it('ondalık virgül', () => {
    expect(parseTrNumber('1.234,5')).toBe(1234.5);
  });
  it('boş ve tire', () => {
    expect(parseTrNumber('-')).toBeNull();
    expect(parseTrNumber('')).toBeNull();
    expect(parseTrNumber(null)).toBeNull();
  });
});

describe('parseCurrency', () => {
  it('TL / USD / EUR', () => {
    expect(parseCurrency('875.000 TL')).toBe('TL');
    expect(parseCurrency('₺')).toBe('TL');
    expect(parseCurrency('$')).toBe('USD');
    expect(parseCurrency('12.000 USD')).toBe('USD');
    expect(parseCurrency('€')).toBe('EUR');
    expect(parseCurrency('9.000 EUR')).toBe('EUR');
  });
  it('bilinmeyen', () => {
    expect(parseCurrency('')).toBeNull();
    expect(parseCurrency('abc')).toBeNull();
  });
});

describe('parseTrDate', () => {
  it('ay adı', () => {
    expect(parseTrDate('18 Kasım 2026')).toBe('2026-11-18');
    expect(parseTrDate('1 Ağustos 2025')).toBe('2025-08-01');
    expect(parseTrDate('5 Şubat 2024')).toBe('2024-02-05');
    expect(parseTrDate('9 Mayıs 2024')).toBe('2024-05-09');
  });
  it('noktalı', () => {
    expect(parseTrDate('18.11.2026')).toBe('2026-11-18');
  });
  it('geçersiz', () => {
    expect(parseTrDate('31 Şubat 2026')).toBeNull();
    expect(parseTrDate('')).toBeNull();
    expect(parseTrDate('dün')).toBeNull();
  });
});

describe('enum eşlemeleri', () => {
  it('vites', () => {
    expect(mapTransmission('Manuel')).toBe('manual');
    expect(mapTransmission('Otomatik')).toBe('automatic');
    expect(mapTransmission('Yarı Otomatik')).toBe('semi-automatic');
    expect(mapTransmission('')).toBeNull();
  });
  it('yakıt', () => {
    expect(mapFuel('Benzin')).toBe('gasoline');
    expect(mapFuel('Dizel')).toBe('diesel');
    expect(mapFuel('LPG & Benzin')).toBe('lpg');
    expect(mapFuel('Hibrit')).toBe('hybrid');
    expect(mapFuel('Elektrik')).toBe('electric');
    expect(mapFuel('Hidrojen')).toBeNull();
  });
  it('satıcı tipi', () => {
    expect(mapSellerType('Sahibinden')).toBe('owner');
    expect(mapSellerType('Galeriden')).toBe('dealer');
    expect(mapSellerType('Yetkili Bayiden')).toBe('authorized-dealer');
    expect(mapSellerType(null)).toBeNull();
  });
  it('evet/hayır', () => {
    expect(parseYesNo('Evet')).toBe(true);
    expect(parseYesNo('Hayır')).toBe(false);
    expect(parseYesNo('belki')).toBeNull();
  });
});

describe('parseRangeOrNumber', () => {
  it('tek değer', () => {
    expect(parseRangeOrNumber('1598 cm3')).toBe(1598);
    expect(parseRangeOrNumber('110 hp')).toBe(110);
  });
  it('aralık null', () => {
    expect(parseRangeOrNumber('1401 - 1600 cm3')).toBeNull();
  });
  it('boş', () => {
    expect(parseRangeOrNumber('')).toBeNull();
    expect(parseRangeOrNumber(undefined)).toBeNull();
  });
});
