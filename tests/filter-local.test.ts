import { describe, expect, it } from 'vitest';
import { appliedFilterNames, evaluateQuery, matchesQuery } from '../src/sahibinden/filter.js';
import { buildSearchUrls } from '../src/sahibinden/url-builder.js';
import { COLOR_IDS, ENGINE_POWER_IDS, ENGINE_POWER_RANGES, ENGINE_VOLUME_RANGES } from '../src/sahibinden/url-schema.js';
import { SearchQuerySchema, type Listing } from '../src/sahibinden/types.js';

const q = (o: object) => SearchQuerySchema.parse(o);
const NOW = new Date('2026-11-18T12:00:00.000Z');
const mk = (o: Partial<Listing> = {}): Listing => ({
  id: '1000000001', url: 'https://www.sahibinden.com/ilan/x-1000000001/detay', title: 'Temiz Golf',
  brand: 'Volkswagen', series: 'Golf', model: '1.6 TDi', year: 2016, km: 100000, color: 'Beyaz',
  price: 800000, currency: 'TL', city: 'Samsun', district: null, listingDate: '2026-11-18',
  transmission: 'automatic', fuel: 'diesel', source: 'listing', capturedAt: '2026-11-18T00:00:00.000Z',
  engine: { volumeCc: 1598, powerHp: 105 }, bodyType: 'Hatchback 5 Kapı', drivetrain: 'Önden Çekiş',
  vehicleCondition: 'İkinci El', sellerType: 'dealer', exchange: true, warranty: false, heavyDamage: false,
  tramerAmount: null, damage: [{ part: 'Ön Kaput', status: 'original' }], description: null, attributes: {}, warnings: [],
  ...o,
});
const ok = (l: Listing, o: object) => matchesQuery(l, q(o), { now: NOW }).match;

describe('yerel filtre: pozitif + negatif', () => {
  it('color (Türkçe katlama, filtrede olmayan renk elenir)', () => {
    expect(ok(mk({ color: 'Gümüş Gri' }), { color: 'silver-gray' })).toBe(true);
    expect(ok(mk({ color: 'Gümüş Gri' }), { color: 'gray' })).toBe(false);
    expect(ok(mk({ color: 'KIRMIZI' }), { color: 'red' })).toBe(true);
    expect(ok(mk({ color: 'Siyah' }), { color: 'white' })).toBe(false);
    expect(evaluateQuery(mk({ color: null }), q({ color: 'white' })).unknownFields).toEqual(['color']);
  });
  it('eksik renkler: Siyah hem URL kimliğine hem yerel filtreye yansır', () => {
    const cases = [['black', 'Siyah'], ['yellow', 'Sarı'], ['champagne', 'Şampanya'], ['turquoise', 'Turkuaz'], ['orange', 'Turuncu'], ['green', 'Yeşil']] as const;
    for (const [color, label] of cases) {
      expect(ok(mk({ color: label }), { color })).toBe(true);
      expect(ok(mk({ color: label.toUpperCase() }), { color })).toBe(true);
      expect(ok(mk({ color: 'Beyaz' }), { color })).toBe(false);
      expect(ok(mk({ color: label }), { color: 'white' })).toBe(false);
    }
    expect(ok(mk({ color: 'Black' }), { color: 'black' })).toBe(true);
    expect(COLOR_IDS.black).toBe('33616');
    expect(buildSearchUrls(q({ color: 'black' }))[0]!.url).toContain('a3=33616');
  });
  it('bodyType', () => {
    expect(ok(mk(), { bodyType: 'hatchback-5-door' })).toBe(true);
    expect(ok(mk(), { bodyType: 'sedan' })).toBe(false);
    expect(ok(mk({ bodyType: 'Station Wagon' }), { bodyType: 'station-wagon' })).toBe(true);
    expect(evaluateQuery(mk({ bodyType: null }), q({ bodyType: 'sedan' })).unknownFields).toEqual(['bodyType']);
  });
  it('drivetrain', () => {
    expect(ok(mk(), { drivetrain: 'fwd' })).toBe(true);
    expect(ok(mk(), { drivetrain: 'awd' })).toBe(false);
    expect(ok(mk({ drivetrain: 'Arkadan İtiş' }), { drivetrain: 'rwd' })).toBe(true);
    expect(ok(mk({ drivetrain: '4WD (Sürekli)' }), { drivetrain: '4wd' })).toBe(true);
    expect(ok(mk({ drivetrain: 'AWD (Elektronik)' }), { drivetrain: 'awd' })).toBe(true);
    expect(ok(mk({ drivetrain: 'AWD (Elektronik)' }), { drivetrain: '4wd' })).toBe(false);
  });
  it('vehicleCondition', () => {
    expect(ok(mk(), { vehicleCondition: 'second-hand' })).toBe(true);
    expect(ok(mk(), { vehicleCondition: 'new' })).toBe(false);
    expect(ok(mk({ vehicleCondition: 'Sıfır' }), { vehicleCondition: 'new' })).toBe(true);
    expect(ok(mk({ vehicleCondition: 'Yurtdışından İthal Sıfır' }), { vehicleCondition: 'imported-new' })).toBe(true);
    expect(ok(mk({ vehicleCondition: 'Yurtdışından İthal Sıfır' }), { vehicleCondition: 'new' })).toBe(false);
  });
  it('sellerType ve exchange', () => {
    expect(ok(mk(), { sellerType: 'dealer' })).toBe(true);
    expect(ok(mk(), { sellerType: 'owner' })).toBe(false);
    expect(ok(mk(), { exchange: true })).toBe(true);
    expect(ok(mk(), { exchange: false })).toBe(false);
    expect(evaluateQuery(mk({ exchange: null }), q({ exchange: true })).unknownFields).toEqual(['exchange']);
  });
  it('warranty', () => {
    expect(ok(mk({ warranty: true }), { warranty: true })).toBe(true);
    expect(ok(mk({ warranty: false }), { warranty: true })).toBe(false);
    expect(ok(mk({ warranty: false }), { warranty: false })).toBe(true);
    expect(evaluateQuery(mk({ warranty: null }), q({ warranty: true })).unknownFields).toEqual(['warranty']);
  });
  it('noHeavyDamage', () => {
    expect(ok(mk({ heavyDamage: false }), { noHeavyDamage: true })).toBe(true);
    expect(ok(mk({ heavyDamage: true }), { noHeavyDamage: true })).toBe(false);
    expect(evaluateQuery(mk({ heavyDamage: null }), q({ noHeavyDamage: true })).unknownFields).toEqual(['noHeavyDamage']);
    expect(ok(mk({ heavyDamage: true }), { noHeavyDamage: false })).toBe(true); // false = filtre yok
  });
  it('enginePower aralıkları id etiketlerinden türetilir', () => {
    expect(ENGINE_POWER_RANGES['76-100']).toEqual({ lo: 75, hi: 100 });
    expect(ENGINE_VOLUME_RANGES['upto-1300']).toEqual({ lo: -Infinity, hi: 1300 });
    const hp = (powerHp: number | null) => mk({ engine: { volumeCc: 1598, powerHp } });
    expect(ok(hp(105), { enginePower: '101-125' })).toBe(true);
    expect(ok(hp(105), { enginePower: '76-100' })).toBe(false);
    expect(ok(hp(100), { enginePower: '76-100' })).toBe(true); // üst sınır dahil
    expect(ok(hp(101), { enginePower: '76-100' })).toBe(false);
    expect(ok(hp(76), { enginePower: '76-100' })).toBe(true); // alt sınır dahil
    expect(ok(hp(75), { enginePower: '76-100' })).toBe(false);
    expect(ok(hp(40), { enginePower: 'upto-50' })).toBe(true);
    expect(evaluateQuery(hp(null), q({ enginePower: '76-100' })).unknownFields).toEqual(['enginePower']);
    expect(evaluateQuery(mk({ engine: null }), q({ enginePower: '76-100' })).unknownFields).toEqual(['enginePower']);
  });
  it('motor gücü: yeni aralıklar ve "601 HP ve üzeri" açık uçlu', () => {
    expect(ENGINE_POWER_RANGES['601-up']).toEqual({ lo: 600, hi: Infinity });
    const hp = (powerHp: number) => mk({ engine: { volumeCc: 3000, powerHp } });
    expect(ok(hp(230), { enginePower: '226-250' })).toBe(true);
    expect(ok(hp(226), { enginePower: '226-250' })).toBe(true);
    expect(ok(hp(225), { enginePower: '226-250' })).toBe(false);
    expect(ok(hp(250), { enginePower: '226-250' })).toBe(true);
    expect(ok(hp(251), { enginePower: '226-250' })).toBe(false);
    expect(ok(hp(600), { enginePower: '576-600' })).toBe(true);
    expect(ok(hp(600), { enginePower: '601-up' })).toBe(false);
    expect(ok(hp(601), { enginePower: '601-up' })).toBe(true);
    expect(ok(hp(1001), { enginePower: '601-up' })).toBe(true);
    expect(ok(hp(601), { enginePower: '576-600' })).toBe(false);
    for (const k of Object.keys(ENGINE_POWER_IDS)) expect(ENGINE_POWER_RANGES[k as keyof typeof ENGINE_POWER_RANGES]).toBeDefined();
    expect(Object.keys(ENGINE_POWER_IDS)).toHaveLength(24);
    expect(ENGINE_POWER_IDS['601-up']).toBe('74365');
    expect(buildSearchUrls(q({ enginePower: '601-up' }))[0]!.url).toContain('a2320=74365');
  });
  it('motor hacmi: 2501-5500 aralıkları sınırlarıyla', () => {
    const cc = (volumeCc: number) => mk({ engine: { volumeCc, powerHp: 105 } });
    const bands = [['2501-3000', 2500, 3000], ['3001-3500', 3000, 3500], ['3501-4000', 3500, 4000], ['4001-4500', 4000, 4500], ['4501-5000', 4500, 5000], ['5001-5500', 5000, 5500]] as const;
    for (const [engineVolume, lo, hi] of bands) {
      expect(ok(cc(lo), { engineVolume })).toBe(false);
      expect(ok(cc(lo + 1), { engineVolume })).toBe(true);
      expect(ok(cc(hi), { engineVolume })).toBe(true);
      expect(ok(cc(hi + 1), { engineVolume })).toBe(false);
    }
    expect(ok(cc(2500), { engineVolume: '2001-2500' })).toBe(true);
  });
  it('motor hacmi: yeni aralıklar ve "6001 cc ve üzeri" açık uçlu', () => {
    const cc = (volumeCc: number) => mk({ engine: { volumeCc, powerHp: 105 } });
    expect(ok(cc(5800), { engineVolume: '5501-6000' })).toBe(true);
    expect(ok(cc(5500), { engineVolume: '5501-6000' })).toBe(false);
    expect(ok(cc(6000), { engineVolume: '5501-6000' })).toBe(true);
    expect(ok(cc(6000), { engineVolume: '6001-up' })).toBe(false);
    expect(ok(cc(6001), { engineVolume: '6001-up' })).toBe(true);
    expect(ok(cc(8000), { engineVolume: '6001-up' })).toBe(true);
    expect(ok(cc(1598), { engineVolume: '6001-up' })).toBe(false);
    expect(buildSearchUrls(q({ engineVolume: '6001-up' }))[0]!.url).toContain('a1864=74369');
    expect(buildSearchUrls(q({ engineVolume: '5501-6000' }))[0]!.url).toContain('a1864=74368');
  });
  it('engineVolume', () => {
    const cc = (volumeCc: number | null) => mk({ engine: { volumeCc, powerHp: 105 } });
    expect(ok(cc(1598), { engineVolume: '1301-1600' })).toBe(true);
    expect(ok(cc(1598), { engineVolume: '1601-1800' })).toBe(false);
    expect(ok(cc(1300), { engineVolume: 'upto-1300' })).toBe(true);
    expect(ok(cc(1301), { engineVolume: 'upto-1300' })).toBe(false);
    expect(ok(cc(2500), { engineVolume: '2001-2500' })).toBe(true);
    expect(evaluateQuery(cc(null), q({ engineVolume: '1301-1600' })).unknownFields).toEqual(['engineVolume']);
  });
  it('listedWithin sınırı (now enjekte)', () => {
    const at = (d: string) => mk({ listingDate: d });
    expect(ok(at('2026-11-18'), { listedWithin: '1day' })).toBe(true);
    expect(ok(at('2026-11-17'), { listedWithin: '1day' })).toBe(true);
    expect(ok(at('2026-11-16'), { listedWithin: '1day' })).toBe(false);
    expect(ok(at('2026-11-15'), { listedWithin: '3days' })).toBe(true);
    expect(ok(at('2026-11-14'), { listedWithin: '3days' })).toBe(false);
    expect(ok(at('2026-11-11'), { listedWithin: '7days' })).toBe(true);
    expect(ok(at('2026-11-10'), { listedWithin: '7days' })).toBe(false);
    expect(ok(at('2026-11-03'), { listedWithin: '15days' })).toBe(true);
    expect(ok(at('2026-11-02'), { listedWithin: '15days' })).toBe(false);
    expect(ok(at('2026-10-19'), { listedWithin: '30days' })).toBe(true);
    expect(ok(at('2026-10-18'), { listedWithin: '30days' })).toBe(false);
    expect(evaluateQuery(mk({ listingDate: null }), q({ listedWithin: '7days' })).unknownFields).toEqual(['listedWithin']);
  });
  it('unpaintedOnly / noReplacedParts', () => {
    const dmg = (...s: ('original' | 'painted' | 'local-painted' | 'changed')[]) => mk({ damage: s.map((status, i) => ({ part: `p${i}`, status })) });
    expect(ok(dmg('original', 'original'), { unpaintedOnly: true })).toBe(true);
    expect(ok(dmg('original', 'painted'), { unpaintedOnly: true })).toBe(false);
    expect(ok(dmg('local-painted'), { unpaintedOnly: true })).toBe(false);
    expect(ok(dmg('changed'), { unpaintedOnly: true })).toBe(true);
    expect(ok(dmg('original'), { noReplacedParts: true })).toBe(true);
    expect(ok(dmg('original', 'changed'), { noReplacedParts: true })).toBe(false);
    expect(ok(dmg('painted'), { noReplacedParts: true })).toBe(true);
    expect(evaluateQuery(mk({ damage: null }), q({ unpaintedOnly: true, noReplacedParts: true })).unknownFields).toEqual([
      'unpaintedOnly', 'noReplacedParts',
    ]);
    expect(ok(dmg('painted'), { unpaintedOnly: false })).toBe(true); // false = filtre yok
  });
  it('özet kaydında detay alanları bilinmiyor sayılır', () => {
    const { engine, bodyType, damage, ...summary } = mk();
    void engine; void bodyType; void damage;
    const r = evaluateQuery(summary, q({ bodyType: 'sedan', enginePower: '76-100', unpaintedOnly: true }));
    expect(r.match).toBe(true);
    expect(r.unknownFields).toEqual(['bodyType', 'enginePower', 'unpaintedOnly']);
  });
});

describe('para birimi', () => {
  const eur = mk({ currency: 'EUR', price: 7500 });
  it('EUR ilan TL filtresine takılmadan girmez; sayılır', () => {
    const r = evaluateQuery(eur, q({ priceMax: 900000 }));
    expect(r).toMatchObject({ match: false, excludedOtherCurrency: true, excludedUnknown: false, unknownFields: [] });
    expect(evaluateQuery(eur, q({ priceMin: 1000 })).match).toBe(false);
  });
  it('priceCurrency=EUR ile girer; TL ilan elenir', () => {
    expect(ok(eur, { priceMax: 8000, priceCurrency: 'EUR' })).toBe(true);
    expect(ok(eur, { priceMax: 5000, priceCurrency: 'EUR' })).toBe(false);
    expect(evaluateQuery(mk(), q({ priceMax: 900000, priceCurrency: 'EUR' })).excludedOtherCurrency).toBe(true);
  });
  it('fiyat filtresi yoksa para birimi elenmez; para birimi boşsa TL varsayılır', () => {
    expect(ok(eur, { city: 'Samsun' })).toBe(true);
    expect(ok(eur, { priceCurrency: 'TL' })).toBe(true);
    expect(ok(mk({ currency: null }), { priceMax: 900000 })).toBe(true);
  });
  it('başka kural da elerse excludedOtherCurrency sayılmaz', () => {
    expect(evaluateQuery(eur, q({ priceMax: 900000, city: 'İzmir' })).excludedOtherCurrency).toBe(false);
  });
});

describe('unknown politikası', () => {
  const l = mk({ color: null, bodyType: null });
  it('include (varsayılan): işaretli döner', () => {
    expect(evaluateQuery(l, q({ color: 'white' }))).toMatchObject({ match: true, unknownFields: ['color'], excludedUnknown: false });
    expect(evaluateQuery(l, q({ color: 'white', unknown: 'include' })).match).toBe(true);
  });
  it('exclude: elenir ve sayılır', () => {
    const r = evaluateQuery(l, q({ color: 'white', bodyType: 'sedan', unknown: 'exclude' }));
    expect(r).toMatchObject({ match: false, excludedUnknown: true, unknownFields: ['color', 'bodyType'] });
  });
  it('bilinen uyuşmazlık excludedUnknown olarak sayılmaz', () => {
    expect(evaluateQuery(l, q({ color: 'white', city: 'İzmir', unknown: 'exclude' })).excludedUnknown).toBe(false);
  });
  it('eski includeUnknown=false = exclude; unknown öncelikli', () => {
    expect(ok(l, { color: 'white', includeUnknown: false })).toBe(false);
    expect(ok(l, { color: 'white', includeUnknown: false, unknown: 'include' })).toBe(true);
  });
});

describe('birleşik filtre ve appliedFilters', () => {
  const all = {
    city: 'samsun', brand: 'volkswagen', models: ['golf'], priceMin: 500000, priceMax: 900000, transmission: 'automatic',
    fuel: 'diesel', yearMin: 2015, yearMax: 2017, kmMax: 150000, color: 'white', bodyType: 'hatchback-5-door',
    sellerType: 'dealer', vehicleCondition: 'second-hand', enginePower: '101-125', engineVolume: '1301-1600',
    drivetrain: 'fwd', exchange: true, warranty: false, listedWithin: '3days', unpaintedOnly: true, noReplacedParts: true,
    noHeavyDamage: true,
  };
  it('hepsi birden eşleşir; tek uyuşmazlık eler', () => {
    expect(ok(mk(), all)).toBe(true);
    expect(evaluateQuery(mk(), q(all)).unknownFields).toEqual([]);
    for (const bad of [
      { color: 'Kırmızı' }, { sellerType: 'owner' as const }, { exchange: false }, { warranty: true }, { heavyDamage: true },
      { listingDate: '2026-11-01' }, { engine: { volumeCc: 1998, powerHp: 105 } },
      { damage: [{ part: 'a', status: 'changed' as const }] }, { currency: 'EUR' as const },
    ]) expect(ok(mk(bad), all)).toBe(false);
  });
  it('appliedFilters her yerel filtreyi adlandırır; page/sort/limit/unknown filtre değil', () => {
    expect(appliedFilterNames(q({ ...all, priceCurrency: 'TL', page: 2, sort: 'km_asc', limit: 5, unknown: 'exclude' })).sort()).toEqual(
      [...Object.keys(all), 'priceCurrency'].sort(),
    );
    expect(appliedFilterNames(q({}))).toEqual([]);
    expect(appliedFilterNames(q({ unpaintedOnly: false, models: [] }))).toEqual([]);
  });
});
