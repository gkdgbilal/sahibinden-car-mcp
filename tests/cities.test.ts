import { describe, expect, it } from 'vitest';
import { CITIES, resolveCity } from '../src/sahibinden/url-schema.js';

/** Resmî plaka sırası (1 = Adana ... 81 = Düzce); tablodan bağımsız yazılmıştır. */
const OFFICIAL = [
  'Adana',
  'Adıyaman',
  'Afyonkarahisar',
  'Ağrı',
  'Amasya',
  'Ankara',
  'Antalya',
  'Artvin',
  'Aydın',
  'Balıkesir',
  'Bilecik',
  'Bingöl',
  'Bitlis',
  'Bolu',
  'Burdur',
  'Bursa',
  'Çanakkale',
  'Çankırı',
  'Çorum',
  'Denizli',
  'Diyarbakır',
  'Edirne',
  'Elazığ',
  'Erzincan',
  'Erzurum',
  'Eskişehir',
  'Gaziantep',
  'Giresun',
  'Gümüşhane',
  'Hakkâri',
  'Hatay',
  'Isparta',
  'Mersin',
  'İstanbul',
  'İzmir',
  'Kars',
  'Kastamonu',
  'Kayseri',
  'Kırklareli',
  'Kırşehir',
  'Kocaeli',
  'Konya',
  'Kütahya',
  'Malatya',
  'Manisa',
  'Kahramanmaraş',
  'Mardin',
  'Muğla',
  'Muş',
  'Nevşehir',
  'Niğde',
  'Ordu',
  'Rize',
  'Sakarya',
  'Samsun',
  'Siirt',
  'Sinop',
  'Sivas',
  'Tekirdağ',
  'Tokat',
  'Trabzon',
  'Tunceli',
  'Şanlıurfa',
  'Uşak',
  'Van',
  'Yozgat',
  'Zonguldak',
  'Aksaray',
  'Bayburt',
  'Karaman',
  'Kırıkkale',
  'Batman',
  'Şırnak',
  'Bartın',
  'Ardahan',
  'Iğdır',
  'Yalova',
  'Karabük',
  'Kilis',
  'Osmaniye',
  'Düzce',
];

describe('81 il plaka tablosu', () => {
  it('resmî plaka listesiyle birebir aynı', () => {
    expect(CITIES.map((c) => c.name)).toEqual(OFFICIAL);
    expect(CITIES.map((c) => c.code)).toEqual(OFFICIAL.map((_, i) => i + 1));
  });

  it('ad ve plaka kodu ile çözülür, hepsi doğrulanmış', () => {
    OFFICIAL.forEach((name, i) => {
      expect(resolveCity(name)?.code).toBe(i + 1);
      expect(resolveCity(String(i + 1))?.name).toBe(name);
      expect(CITIES[i]?.verified).toBe(true);
    });
  });
});
