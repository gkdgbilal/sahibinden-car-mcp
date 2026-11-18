import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from 'cheerio';
import {
  detectPageType, extractPageUrl, parseListingPage, parseSearchPage,
} from '../src/sahibinden/parser.js';
import { ListingSchema, ListingSummarySchema } from '../src/sahibinden/types.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (name: string) => readFileSync(path.join(dir, name), 'utf8');
const ctx = { capturedAt: '2026-11-18T12:00:00.000Z' };

describe('detectPageType', () => {
  it('fixture tipleri', () => {
    expect(detectPageType(fx('search.synthetic.html'))).toBe('search');
    expect(detectPageType(fx('listing.synthetic.html'))).toBe('listing');
    expect(detectPageType(fx('challenge.html'))).toBe('challenge');
  });
  it('rastgele HTML unknown', () => {
    expect(detectPageType('<html><body><p>merhaba</p></body></html>')).toBe('unknown');
    expect(detectPageType('')).toBe('unknown');
  });
});

describe('extractPageUrl', () => {
  it('saved from url yorumu', () => {
    const html = '<!-- saved from url=(0047)https://www.sahibinden.com/ilan/x-1234567890/detay -->\n<html></html>';
    expect(extractPageUrl(load(html), html, ctx)).toBe('https://www.sahibinden.com/ilan/x-1234567890/detay');
  });
  it('sourceUrl yedeği ve hiçbiri', () => {
    const html = '<html></html>';
    expect(extractPageUrl(load(html), html, { ...ctx, sourceUrl: 'https://a.test/x' })).toBe('https://a.test/x');
    expect(extractPageUrl(load(html), html, ctx)).toBeNull();
  });
});

describe('parseSearchPage', () => {
  const { items, warnings } = parseSearchPage(fx('search.synthetic.html'), ctx);

  it('reklam satırı atlanır, 3 öğe', () => {
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['1000000001', '1000000002', '1000000003']);
    expect(warnings).toEqual([]);
  });
  it('ilk öğe alanları', () => {
    expect(items[0]).toEqual({
      id: '1000000001',
      url: 'https://www.sahibinden.com/ilan/vasita-otomobil-volkswagen-golf-ornek-temiz-1000000001/detay',
      title: 'Sahibinden temiz Golf 1.6 TDi',
      brand: null,
      series: 'Golf',
      model: '1.6 TDi Comfortline',
      year: 2016,
      km: 125000,
      color: 'Beyaz',
      price: 875000,
      currency: 'TL',
      city: 'Samsun',
      district: 'Atakum',
      listingDate: '2026-11-18',
      transmission: null,
      fuel: null,
      source: 'search',
      capturedAt: ctx.capturedAt,
    });
  });
  it('URL mutlak ve sorgusuz; şema uyumlu', () => {
    for (const i of items) {
      expect(i.url.startsWith('https://www.sahibinden.com/')).toBe(true);
      expect(i.url).not.toContain('?');
      expect(() => ListingSummarySchema.parse(i)).not.toThrow();
    }
  });
  it('Türkçe ilçe', () => {
    expect(items[1]!.district).toBe('İlkadım');
  });
  it('fiyatsız satır uyarı üretir', () => {
    const html = fx('search.synthetic.html').replace('<div>780.000 TL</div>', '<div>-</div>');
    const r = parseSearchPage(html, ctx);
    expect(r.items[1]!.price).toBeNull();
    expect(r.warnings.some((w) => w.includes('1000000002'))).toBe(true);
  });
  it('sütun sırası değişse de başlıktan eşler', () => {
    const html = `<table id="searchResultsTable"><thead><tr><td>Fiyat</td><td>Yıl</td><td>KM</td></tr></thead>
      <tbody><tr class="searchResultsItem" data-id="1000000009"><td>500.000 TL</td><td>2020</td><td>10.000</td></tr></tbody></table>`;
    const r = parseSearchPage(html, ctx);
    expect(r.items[0]).toMatchObject({ id: '1000000009', price: 500000, year: 2020, km: 10000 });
  });
});

describe('parseListingPage', () => {
  const html = fx('listing.synthetic.html');
  const l = parseListingPage(html, ctx);

  it('temel alanlar', () => {
    expect(l.id).toBe('1000000001');
    expect(l.url).toBe('https://www.sahibinden.com/ilan/vasita-otomobil-volkswagen-golf-ornek-temiz-1000000001/detay');
    expect(l.title).toBe('Sahibinden temiz Golf 1.6 TDi Comfortline');
    expect(l.price).toBe(875000);
    expect(l.currency).toBe('TL');
    expect(l.year).toBe(2016);
    expect(l.km).toBe(125000);
    expect(l.brand).toBe('Volkswagen');
    expect(l.series).toBe('Golf');
    expect(l.city).toBe('Samsun');
    expect(l.district).toBe('Atakum');
    expect(l.listingDate).toBe('2026-11-18');
    expect(l.source).toBe('listing');
  });
  it('enumlar ve motor', () => {
    expect(l.transmission).toBe('automatic');
    expect(l.fuel).toBe('diesel');
    expect(l.sellerType).toBe('dealer');
    expect(l.exchange).toBe(true);
    expect(l.warranty).toBe(false);
    expect(l.heavyDamage).toBe(false);
    expect(l.engine).toEqual({ volumeCc: 1598, powerHp: 105 });
    expect(l.bodyType).toBe('Hatchback 5 Kapı');
    expect(l.drivetrain).toBe('Önden Çekiş');
    expect(l.vehicleCondition).toBe('İkinci El');
  });
  it('hasar ve tramer', () => {
    expect(l.damage).toEqual([
      { part: 'Ön Kaput', status: 'painted' },
      { part: 'Sağ Ön Çamurluk', status: 'painted' },
      { part: 'Tavan', status: 'local-painted' },
      { part: 'Arka Tampon', status: 'changed' },
    ]);
    expect(l.tramerAmount).toBe(12500);
    expect(l.tramerStatus).toBe('amount');
    expect(l.tramerRecords).toEqual([{ amount: 12500, note: expect.any(String) }]);
    expect(l.warnings).toContain('tramer açıklamadan çıkarıldı, satıcı beyanı, doğrulanmadı');
  });
  it('bilinmeyen etiketler attributes içinde kalır', () => {
    expect(l.attributes['Plaka / Uyruk']).toBe('TR Plakalı');
    expect(l.attributes['Motor Hacmi']).toBe('1598 cm3');
  });
  it('satıcı adı ve telefon sızmaz', () => {
    const json = JSON.stringify(l);
    expect(json).not.toContain('0500 000 12 34');
    expect(json).not.toContain('000 12 34');
    expect(json).not.toContain('Örnek Otomotiv');
    expect(json).not.toContain('Mağaza');
    expect(l.description).toContain('[telefon]');
  });
  it('açıklama ≤ 4000 ve şema uyumlu', () => {
    const long = html.replace('Aracımız bakımlıdır', 'x'.repeat(6000));
    const l2 = parseListingPage(long, ctx);
    expect(l2.description!.length).toBeLessThanOrEqual(4000);
    expect(() => ListingSchema.parse(l)).not.toThrow();
  });
  it('eksik alanlar uyarı üretir', () => {
    const stripped = html
      .replace('<li><strong>KM</strong><span>125.000</span></li>', '')
      .replace('<li><strong>Yıl</strong><span>2016</span></li>', '');
    const l3 = parseListingPage(stripped, ctx);
    expect(l3.km).toBeNull();
    expect(l3.warnings).toEqual(expect.arrayContaining(['km okunamadı', 'yıl okunamadı']));
  });
  it('ilan no yoksa URL kalıbından; hiçbiri yoksa hata', () => {
    const noId = html.replace('<li><strong>İlan No</strong><span>1000000001</span></li>', '');
    expect(parseListingPage(noId, ctx).id).toBe('1000000001');
    const none = noId.replace(/<link rel="canonical"[^>]*>/, '');
    expect(() => parseListingPage(none, ctx)).toThrow('ilan no bulunamadı');
  });
  it('hasar bölümü yoksa damage null', () => {
    const noDamage = html.replace(/<div class="classifiedDamageInfo">[\s\S]*?<\/div>/, '');
    expect(parseListingPage(noDamage, ctx).damage).toBeNull();
  });
});

describe('gerçek yapıyı taklit eden fixture: arama', () => {
  const html = fx('real-shape.search.html');
  const r = parseSearchPage(html, ctx);

  it('sayfa tipi search', () => {
    expect(detectPageType(html)).toBe('search');
  });
  it('data-id ile 3 ilan, nativeAd satırları atlanır', () => {
    expect(r.items.map((i) => i.id)).toEqual(['1000000101', '1000000102', '1000000103']);
    expect(r.warnings).toEqual([]);
  });
  it('ilk öğe: yıl/km/renk, fiyat, tarih, konum, URL', () => {
    expect(r.items[0]).toEqual({
      id: '1000000101',
      url: 'https://www.sahibinden.com/ilan/vasita-otomobil-ornekmarka-orekseri-ornek-baslik-bir-1000000101/detay',
      title: 'Örnek başlık bir',
      brand: null,
      series: null,
      model: '1.3 CDTI Enjoy',
      year: 2006,
      km: 226000,
      color: 'Gümüş Gri',
      price: 549000,
      currency: 'TL',
      city: 'Kocaeli',
      district: 'Körfez',
      listingDate: '2026-11-18',
      transmission: null,
      fuel: null,
      source: 'search',
      capturedAt: ctx.capturedAt,
    });
  });
  it('başlık href="#" iken URL thumbnail bağlantısından; favori metni başlığa sızmaz', () => {
    expect(r.items[1]!.url).toBe(
      'https://www.sahibinden.com/ilan/vasita-otomobil-ornekmarka-orekseri-ornek-baslik-iki-1000000102/detay',
    );
    for (const i of r.items) {
      expect(i.title).not.toContain('Favori');
      expect(() => ListingSummarySchema.parse(i)).not.toThrow();
    }
  });
  it('boşlukla ayrık il/ilçe ve EUR', () => {
    expect(r.items[1]).toMatchObject({ city: 'İstanbul', district: 'Kadıköy', price: 1020000 });
    expect(r.items[2]).toMatchObject({ currency: 'EUR', price: 7500, city: 'Samsun', district: 'Atakum' });
    expect(r.items[2]!.title).toBe('Örnek başlık üç Škoda');
  });
  it('toplam ilan sayısı ve sayfalama', () => {
    expect(r.totalCount).toBe(2836);
    expect(r.pagination).toEqual({ offsets: [20, 40, 60], pageSize: 20 });
  });
  it('sayfalama/toplam yoksa null', () => {
    const plain = parseSearchPage(fx('search.synthetic.html'), ctx);
    expect(plain.pagination).toBeNull();
    expect(plain.totalCount).toBeNull();
  });
});

describe('konum hücresi: şehir filtresiz "İl İlçe" ve şehir filtreli "İlçe Mahalle"', () => {
  const filtered = fx('real-shape.search-city.html');

  it('filtresiz sayfa: bağlam unfiltered, il + ilçe, locationRaw/neighborhood yazılmaz', () => {
    const r = parseSearchPage(fx('real-shape.search.html'), ctx);
    expect(r.location).toEqual({ mode: 'unfiltered', city: null, source: null });
    expect(r.items[0]).toMatchObject({ city: 'Kocaeli', district: 'Körfez' });
    expect('locationRaw' in r.items[0]!).toBe(false);
    expect('neighborhood' in r.items[0]!).toBe(false);
  });

  it('şehir filtreli sayfa (canonical yolu + başlık): il bağlamdan, ilçe ilk sözcük, mahalle kalan', () => {
    const r = parseSearchPage(filtered, ctx);
    expect(r.location).toEqual({ mode: 'city-filtered', city: 'Samsun', source: 'url' });
    expect(r.warnings).toEqual([]);
    expect(r.items[0]).toMatchObject({
      city: 'Samsun', district: 'İlkadım', neighborhood: 'Merkez', locationRaw: 'İlkadım Merkez',
    });
    expect(r.items[1]).toMatchObject({ city: 'Samsun', district: 'Atakum', neighborhood: 'Altınkum' });
    for (const i of r.items) expect(() => ListingSummarySchema.parse(i)).not.toThrow();
  });

  it('"19 Mayıs" gibi sayıyla başlayan ilçe iki sözcüktür', () => {
    const r = parseSearchPage(filtered, ctx);
    expect(r.items[2]).toMatchObject({ city: 'Samsun', district: '19 Mayıs', neighborhood: 'Merkez' });
  });

  it('yalnızca başlıktan (canonical yok) şehir filtreli sayılır', () => {
    const html = filtered.replace(/<link rel="canonical"[^>]*>/, '');
    expect(parseSearchPage(html, ctx).location).toEqual({ mode: 'city-filtered', city: 'Samsun', source: 'title' });
  });

  it('cityHint başlık/URL yokken konumu çözer; Türkçe katlama (izmir -> İzmir)', () => {
    const html = filtered.replace(/<link rel="canonical"[^>]*>/, '').replace(/<title>[^<]*<\/title>/, '<title>Fiyatlar</title>');
    expect(parseSearchPage(html, ctx).location.mode).toBe('unfiltered');
    const r = parseSearchPage(html, { ...ctx, cityHint: 'samsun' });
    expect(r.location).toEqual({ mode: 'city-filtered', city: 'Samsun', source: 'hint' });
    expect(r.items[0]).toMatchObject({ city: 'Samsun', district: 'İlkadım' });
    expect(parseSearchPage(html, { ...ctx, cityHint: 'izmir' }).items[1]!.city).toBe('İzmir');
  });

  it('sourceUrl sorgusundaki address_city (plaka) şehri verir', () => {
    const html = filtered.replace(/<link rel="canonical"[^>]*>/, '').replace(/<title>[^<]*<\/title>/, '<title>Fiyatlar</title>');
    const r = parseSearchPage(html, { ...ctx, sourceUrl: 'https://www.sahibinden.com/otomobil?address_city=34' });
    expect(r.location).toEqual({ mode: 'city-filtered', city: 'İstanbul', source: 'url' });
    expect(r.items[0]!.city).toBe('İstanbul');
  });

  it('çelişen sinyaller (başlık Samsun, URL İstanbul): tahmin yok, locationRaw + uyarı', () => {
    const r = parseSearchPage(filtered, { ...ctx, sourceUrl: 'https://www.sahibinden.com/otomobil?address_city=34' });
    // canonical (Samsun) ile sourceUrl (İstanbul) çelişir
    expect(r.location.mode).toBe('ambiguous');
    expect(r.items[0]).toMatchObject({ city: null, district: null, locationRaw: 'İlkadım Merkez' });
    expect(r.warnings.some((w) => w.includes('1000000201') && w.includes('belirsiz'))).toBe(true);
  });

  it('filtresiz varsayımda ilk sözcük il değilse (sinyal yok) belirsiz: il/ilçe boş, locationRaw korunur', () => {
    const html = filtered.replace(/<link rel="canonical"[^>]*>/, '').replace(/<title>[^<]*<\/title>/, '<title>Fiyatlar</title>');
    const r = parseSearchPage(html, ctx);
    expect(r.items[0]).toMatchObject({ city: null, district: null, locationRaw: 'İlkadım Merkez' });
    expect(r.warnings.length).toBe(3);
  });

  it('şehir filtreli varsayımda hücre il adıyla başlıyorsa çelişki: belirsiz', () => {
    const html = filtered.replace('İlkadım Merkez', 'Samsun Atakum');
    const r = parseSearchPage(html, ctx);
    expect(r.items[0]).toMatchObject({ city: null, district: null, locationRaw: 'Samsun Atakum' });
    expect(r.items[1]!.city).toBe('Samsun');
  });

  it('<br> ile ayrık satırlar filtreli sayfada ilçe + mahalle olur', () => {
    const html = filtered.replace('İlkadım Merkez', 'İlkadım<br>Cumhuriyet Mah');
    expect(parseSearchPage(html, ctx).items[0]).toMatchObject({ district: 'İlkadım', neighborhood: 'Cumhuriyet Mah' });
  });
});

describe('gerçek yapıyı taklit eden fixture: ilan', () => {
  const html = fx('real-shape.listing.html');
  const l = parseListingPage(html, ctx);

  it('sayfa tipi listing', () => {
    expect(detectPageType(html)).toBe('listing');
  });
  it('dt/dd eşleme (baş boşluklu dt, KM etiketi)', () => {
    expect(l.id).toBe('1000000101');
    expect(l.title).toBe('Örnek başlık bir');
    expect(l.brand).toBe('Örnek Marka');
    expect(l.series).toBe('Örnek Seri');
    expect(l.model).toBe('1.3 CDTI');
    expect(l.year).toBe(2006);
    expect(l.km).toBe(226000);
    expect(l.color).toBe('Gümüş Gri');
    expect(l.listingDate).toBe('2026-11-18');
    expect(l.fuel).toBe('diesel');
    expect(l.transmission).toBe('manual');
    expect(l.engine).toEqual({ volumeCc: 1248, powerHp: 90 });
    expect(l.sellerType).toBe('owner');
    expect(l.exchange).toBe(true);
    expect(l.warranty).toBe(false);
    expect(l.heavyDamage).toBe(false);
    expect(l.bodyType).toBe('Hatchback 5 Kapı');
    expect(l.drivetrain).toBe('Önden Çekiş');
    expect(l.vehicleCondition).toBe('İkinci El');
    expect(l.attributes['Plaka / Uyruk']).toBe('TR Plakalı');
  });
  it('fiyat gürültüsüz (price-all, hidden input)', () => {
    expect(l.price).toBe(549000);
    expect(l.currency).toBe('TL');
  });
  it('URL canonical, şema uyumlu', () => {
    expect(l.url).toBe('https://www.sahibinden.com/ilan/vasita-otomobil-ornekmarka-orekseri-ornek-baslik-bir-1000000101/detay');
    expect(() => ListingSchema.parse(l)).not.toThrow();
  });
  it('hasar şeması: lejant hariç, parça sınıfından durum', () => {
    expect(l.damage).toEqual([
      { part: 'front-right-mudguard', status: 'painted' },
      { part: 'front-right-door', status: 'original' },
      { part: 'rear-right-mudguard', status: 'changed' },
      { part: 'front-left-mudguard', status: 'local-painted' },
      { part: 'roof', status: 'original' },
    ]);
  });
  it('metin kısaltması yedeği (sınıf yoksa B/D/L)', () => {
    const noClass = html
      .replace('front-right-mudguard painted-new', 'front-right-mudguard')
      .replace('rear-right-mudguard changed-new', 'rear-right-mudguard');
    const l2 = parseListingPage(noClass, ctx);
    expect(l2.damage).toEqual(expect.arrayContaining([
      { part: 'front-right-mudguard', status: 'painted' },
      { part: 'rear-right-mudguard', status: 'changed' },
    ]));
    expect(l2.warnings).toContain('hasar durumu metin kısaltmasından okundu (doğrulanmadı)');
  });
  it('açıklama, telefon maskeli, gizli metin yok', () => {
    expect(l.description).toContain('Örnek açıklama');
    expect(l.description).toContain('[telefon]');
    expect(l.tramerAmount).toBe(12500);
  });
  it('satıcı/telefon/gürültü dl sızmaz', () => {
    const json = JSON.stringify(l);
    for (const bad of ['0500 000 12 34', '000 12 34', 'Örnek Otomotiv', 'Hesap açma', 'Cep', 'Şifre', 'E-posta']) {
      expect(json).not.toContain(bad);
    }
    expect(json).not.toContain('Favori Listenize');
    expect(Object.keys(l.attributes)).not.toContain('Cep');
  });
  it('konum breadcrumb bağlantılarından: il/ilçe/mahalle, uyarı yok', () => {
    expect(l.city).toBe('Samsun');
    expect(l.district).toBe('Atakum');
    expect(l.neighborhood).toBe('Örnek Mh.');
    expect(l.warnings.some((w) => w.includes('konum'))).toBe(false);
  });
  it('breadcrumb arasında ek halka varsa: ilk il, ikinci ilçe, son mahalle', () => {
    const extra = html.replace(
      '<span>/</span>\n        <a href="https://www.sahibinden.com/ornek-samsun-atakum-ornek',
      '<span>/</span> <a data-click-label="Adres Breadcrumb | Örnek Semt"> Örnek Semt</a> <span>/</span>\n        <a href="https://www.sahibinden.com/ornek-samsun-atakum-ornek',
    );
    expect(extra).not.toBe(html);
    expect(parseListingPage(extra, ctx)).toMatchObject({ city: 'Samsun', district: 'Atakum', neighborhood: 'Örnek Mh.' });
  });
  it('breadcrumb tek halkaysa yalnızca il', () => {
    const one = html.replace(/<a [^>]*Adres Breadcrumb \| (Atakum|Örnek Mh\.)"[^>]*>[^<]*<\/a>/g, '');
    const l2 = parseListingPage(one, ctx);
    expect(l2.city).toBe('Samsun');
    expect(l2.district).toBeNull();
    expect(l2.warnings.some((w) => w.includes('konum'))).toBe(false);
  });
  it('breadcrumb yoksa gmap data-* yedeği (plaka kodu -> il adı)', () => {
    const noCrumb = html.replace(/<a [^>]*Adres Breadcrumb[^>]*>[^<]*<\/a>/g, '');
    const l2 = parseListingPage(noCrumb, ctx);
    expect(l2).toMatchObject({ city: 'Samsun', district: 'Atakum', neighborhood: 'Örnek Mh.' });
    expect(l2.warnings.some((w) => w.includes('konum'))).toBe(false);
    expect(() => ListingSchema.parse(l2)).not.toThrow();
  });
  it('breadcrumb ve gmap yoksa: null + uyarı', () => {
    const none = html
      .replace(/<a [^>]*Adres Breadcrumb[^>]*>[^<]*<\/a>/g, '')
      .replace(/<div id="gmap"[^>]*><\/div>/, '');
    const l2 = parseListingPage(none, ctx);
    expect(l2.city).toBeNull();
    expect(l2.district).toBeNull();
    expect(l2.neighborhood).toBeUndefined();
    expect(l2.warnings.some((w) => w.includes('konum'))).toBe(true);
  });
});
