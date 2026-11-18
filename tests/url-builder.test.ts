import { describe, expect, it } from 'vitest';
import { buildSearchUrls } from '../src/sahibinden/url-builder.js';
import { SearchQuerySchema } from '../src/sahibinden/types.js';

const q = (o: object) => SearchQuerySchema.parse(o);

describe('buildSearchUrls', () => {
  it('Samsun / Golf / fiyat-yıl-km örneği', () => {
    const urls = buildSearchUrls(
      q({ city: 'Samsun', brand: 'Volkswagen', models: ['Golf'], priceMin: 700000, priceMax: 900000, yearMin: 2015, kmMax: 150000 }),
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]!.url).toBe(
      'https://www.sahibinden.com/volkswagen-golf/samsun?price_min=700000&price_max=900000&a5_min=2015&a4_max=150000&sorting=price_asc',
    );
    expect(urls[0]!.note).toContain('URL şeması doğrulanmadı');
  });

  it('vites URL\'e eklenmez, not düşer', () => {
    const [u] = buildSearchUrls(q({ models: ['Golf'], transmission: 'automatic' }));
    expect(u!.url).not.toMatch(/a116445|vites|transmission/i);
    expect(u!.note).toContain('Vites (Otomatik) filtresini sahibinden panelinden seçin.');
  });

  it('4 model -> 4 URL (marka haritadan)', () => {
    const urls = buildSearchUrls(q({ city: 'İzmir', models: ['Golf', 'Astra', 'Focus', 'Megane'] }));
    expect(urls.map((u) => new URL(u.url).pathname)).toEqual([
      '/volkswagen-golf/izmir', '/opel-astra/izmir', '/ford-focus/izmir', '/renault-megane/izmir',
    ]);
  });

  it('bilinmeyen model genel sayfaya düşer, not ile', () => {
    const [u] = buildSearchUrls(q({ models: ['Zzz'] }));
    expect(new URL(u!.url).pathname).toBe('/otomobil');
    expect(u!.note).toContain('marka bilinmiyor');
  });

  it('model yok -> /otomobil (+ marka); sıralama eşlemesi', () => {
    expect(new URL(buildSearchUrls(q({}))[0]!.url).pathname).toBe('/otomobil');
    expect(new URL(buildSearchUrls(q({ brand: 'Skoda' }))[0]!.url).pathname).toBe('/otomobil/skoda');
    expect(buildSearchUrls(q({ sort: 'km_asc' }))[0]!.url).not.toContain('sorting');
    expect(buildSearchUrls(q({ sort: 'date_desc' }))[0]!.url).toContain('sorting=date_desc');
  });
});
