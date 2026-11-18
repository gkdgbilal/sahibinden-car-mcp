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
    expect(l.warnings).toContain('tramer açıklamadan çıkarıldı (doğrulanmadı)');
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
