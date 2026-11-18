import { describe, expect, it } from 'vitest';
import { buildSearchUrls } from '../src/sahibinden/url-builder.js';
import { SearchQuerySchema } from '../src/sahibinden/types.js';

const q = (o: object) => SearchQuerySchema.parse(o);
const first = (o: object) => buildSearchUrls(q(o))[0]!;
const params = (o: object) => Object.fromEntries(new URL(first(o).url).searchParams);

describe('buildSearchUrls', () => {
  it('Samsun / Golf / fiyat-yıl-km örneği (doğrulanmış şehir: not yok)', () => {
    const urls = buildSearchUrls(
      q({ city: 'Samsun', brand: 'Volkswagen', models: ['Golf'], priceMin: 700000, priceMax: 900000, yearMin: 2015, kmMax: 150000 }),
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]!.url).toBe(
      'https://www.sahibinden.com/volkswagen-golf?price_min=700000&price_max=900000&a5_min=2015&a4_max=150000&address_city=55&sorting=price_asc',
    );
    expect(urls[0]!.note).toBeUndefined();
  });

  it('doğrulanmış birleşik örnek: motor sluga nokta ile girer, vites + sıralama', () => {
    const u = first({
      city: 'Samsun', brand: 'Opel', models: ['Astra 1.3 CDTI'], transmission: 'manual',
      priceMax: 600000, kmMax: 250000, yearMin: 2008,
    });
    const url = new URL(u.url);
    expect(url.pathname).toBe('/opel-astra-1.3-cdti');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      price_max: '600000', a5_min: '2008', a4_max: '250000', address_city: '55', a6: '32467', sorting: 'price_asc',
    });
  });

  it('vites ve yakıt kimlikleri', () => {
    expect(params({ transmission: 'automatic' }).a6).toBe('32466');
    expect(params({ fuel: 'diesel' }).a17).toBe('22');
    expect(params({ fuel: 'gasoline' }).a17).toBe('21');
    expect(params({ fuel: 'lpg' }).a17).toBe('50276');
    expect(params({ fuel: 'electric' }).a17).toBe('1202111');
    const hybrid = first({ fuel: 'hybrid' });
    expect(new URL(hybrid.url).searchParams.get('a17')).toBe('1312756');
    expect(hybrid.note).toContain('1312757');
  });

  it('yarı otomatik vites URL\'e eklenmez, not düşer', () => {
    const u = first({ models: ['Golf'], transmission: 'semi-automatic' });
    expect(new URL(u.url).searchParams.has('a6')).toBe(false);
    expect(u.note).toContain('Vites (Yarı Otomatik)');
  });

  it('kimden / kasa / renk / durum / çekiş', () => {
    expect(params({ sellerType: 'owner' }).a706).toBe('32474');
    expect(params({ sellerType: 'dealer' }).a706).toBe('32475');
    expect(params({ sellerType: 'authorized-dealer' }).a706).toBe('1160380');
    expect(params({ bodyType: 'hatchback-5-door' }).a8).toBe('62068');
    expect(params({ bodyType: 'sedan' }).a8).toBe('250');
    expect(params({ color: 'silver-gray' }).a3).toBe('40948');
    expect(params({ color: 'white' }).a3).toBe('33611');
    expect(params({ vehicleCondition: 'imported-new' }).a113987).toBe('1252386');
    expect(params({ drivetrain: 'awd' }).a9213).toBe('136272');
    expect(params({ drivetrain: 'fwd' }).a9213).toBe('136269');
  });

  it('motor gücü (a2320) ve hacmi (a1864) aralıkları', () => {
    expect(params({ enginePower: 'upto-50' }).a2320).toBe('1096156');
    expect(params({ enginePower: '101-125' }).a2320).toBe('74345');
    expect(params({ enginePower: '201-225' }).a2320).toBe('74349');
    expect(params({ engineVolume: 'upto-1300' }).a1864).toBe('51977');
    expect(params({ engineVolume: '1301-1600' }).a1864).toBe('1118042');
    expect(params({ engineVolume: '2001-2500' }).a1864).toBe('51981');
  });

  it('takas, tarih, boyasız/değişensiz, para birimi, sayfalama', () => {
    expect(params({ exchange: true }).exchange).toBe('yes');
    expect(params({ exchange: false }).exchange).toBe('no');
    expect(params({ listedWithin: '7days' }).date).toBe('7days');
    expect(params({ unpaintedOnly: true }).unpaintedParts).toBe('true');
    expect(params({ noReplacedParts: true }).unchangingTracks).toBe('true');
    expect(params({ unpaintedOnly: false })).not.toHaveProperty('unpaintedParts');
    expect(params({ noHeavyDamage: true }).a116445).toBe('1263354');
    expect(params({ noHeavyDamage: false })).not.toHaveProperty('a116445');
    expect(params({ warranty: true }).a4054).toBe('72906');
    expect(params({ warranty: false }).a4054).toBe('72907');
    expect(params({ priceCurrency: 'USD' }).price_currency).toBe('2');
    expect(params({ priceCurrency: 'EUR' }).price_currency).toBe('3');
    expect(params({ priceCurrency: 'GBP' }).price_currency).toBe('4');
    expect(params({ priceCurrency: 'TL' })).not.toHaveProperty('price_currency');
    expect(params({})).not.toHaveProperty('pagingOffset');
    expect(params({ page: 1 })).not.toHaveProperty('pagingOffset');
    expect(params({ page: 3 }).pagingOffset).toBe('40');
  });

  it('sıralama değerleri', () => {
    const s = (sort: string) => params({ sort }).sorting;
    expect(s('price_asc')).toBe('price_asc');
    expect(s('price_desc')).toBe('price_desc');
    expect(s('date_desc')).toBe('date_desc');
    expect(s('date_asc')).toBe('date_asc');
    expect(s('km_asc')).toBe('km-nu_asc');
    expect(s('km_desc')).toBe('km-nu_desc');
    expect(s('year_asc')).toBe('yil-nu_asc');
    expect(s('year_desc')).toBe('yil-nu_desc');
  });

  it('şehir: doğrulanmış (İstanbul 34), doğrulanmamış (not), bilinmeyen (eklenmez)', () => {
    const ist = first({ city: 'İstanbul' });
    expect(new URL(ist.url).searchParams.get('address_city')).toBe('34');
    expect(ist.note).toBeUndefined();

    const izmir = first({ city: 'izmir' });
    expect(new URL(izmir.url).searchParams.get('address_city')).toBe('35');
    expect(izmir.note).toContain('doğrulanmadı');
    expect(izmir.note).toContain('İzmir = 35');

    const nowhere = first({ city: 'Atlantis' });
    expect(new URL(nowhere.url).searchParams.has('address_city')).toBe(false);
    expect(nowhere.note).toContain('tanınmadı');
  });

  it('4 model -> 4 URL (marka haritadan), şehir yol değil sorgu', () => {
    const urls = buildSearchUrls(q({ city: 'İzmir', models: ['Golf', 'Astra', 'Focus', 'Megane'] }));
    expect(urls.map((u) => new URL(u.url).pathname)).toEqual([
      '/volkswagen-golf', '/opel-astra', '/ford-focus', '/renault-megane',
    ]);
  });

  it('bilinmeyen model genel sayfaya düşer, not ile', () => {
    const [u] = buildSearchUrls(q({ models: ['Zzz'] }));
    expect(new URL(u!.url).pathname).toBe('/otomobil');
    expect(u!.note).toContain('marka bilinmiyor');
  });

  it('model yok -> /otomobil; yalnızca marka -> /{marka}', () => {
    expect(new URL(first({}).url).pathname).toBe('/otomobil');
    expect(new URL(first({ brand: 'Skoda' }).url).pathname).toBe('/skoda');
    expect(new URL(first({ brand: 'Opel' }).url).pathname).toBe('/opel');
  });

  it('zod enum dışı değerleri reddeder', () => {
    expect(SearchQuerySchema.safeParse({ color: 'turuncu' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ bodyType: 'suv' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ listedWithin: '2days' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});
