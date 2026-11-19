import { describe, expect, it } from 'vitest';
import { Catalog, catalog, resolveVehicle } from '../src/sahibinden/catalog.js';
import { extractCategoryTree, CatalogLearner } from '../src/sahibinden/catalog-learn.js';
import { buildSearchUrls } from '../src/sahibinden/url-builder.js';
import { SearchQuerySchema } from '../src/sahibinden/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const paths = (brand: string | undefined, model: string | null) => resolveVehicle(brand, model).targets.map((t) => t.path);
const urls = (o: object) => buildSearchUrls(SearchQuerySchema.parse(o));
const one = (o: object) => { const [u] = urls(o); return { url: new URL(u!.url), note: u!.note, label: u!.label }; };

describe('katalog: paketlenen veri (siteden toplanan)', () => {
  it('3 kategori, otomobil 96 marka', () => {
    expect(Object.keys(catalog.data.categories.otomobil!)).toHaveLength(96);
    expect(Object.keys(catalog.data.categories['arazi-suv-pickup']!)).toHaveLength(72);
    expect(Object.keys(catalog.data.categories['minivan-panelvan']!)).toHaveLength(41);
  });
  it('her seri yolu marka yolunu önek alır ve slug karakterleri geçerlidir', () => {
    for (const [cat, brands] of Object.entries(catalog.data.categories)) {
      for (const [b, v] of Object.entries(brands!)) {
        expect(b).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
        for (const s of Object.keys(v.s)) expect(s, `${cat}/${b}`).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
      }
    }
  });
});

describe('model çözümleme', () => {
  it('Mercedes C 200 d varyantları -> doğrulanmış motor yolu', () => {
    expect(paths('Mercedes', 'C 200 d')).toEqual(['mercedes-benz-c-serisi-c-200-d']);
    expect(paths('Mercedes-Benz', 'C200d')).toEqual(['mercedes-benz-c-serisi-c-200-d']);
    expect(paths('benz', 'C 200 d BlueTEC')).toEqual(['mercedes-benz-c-serisi-c-200-d-bluetec']);
  });
  it('BMW: 320d, "3 Serisi 320d xDrive", seri ("3 Serisi") ve SUV (X5)', () => {
    expect(paths('BMW', '320d')).toEqual(['bmw-3-serisi-320d']);
    expect(paths('BMW', '3 Serisi 320d xDrive')).toEqual(['bmw-3-serisi-320d-xdrive']);
    expect(paths('BMW', '3 Serisi')).toEqual(['bmw-3-serisi']);
    expect(paths('BMW', 'X5')).toEqual(['arazi-suv-pickup-bmw-x5']);
    expect(paths('BMW', 'iX3')).toEqual(['arazi-suv-pickup-bmw-ix3']);
  });
  it('motor + ek parça: motor sayfasına düşer ve not düşer', () => {
    const r = resolveVehicle('BMW', '320d M Sport');
    expect(r.targets.map((t) => t.path)).toEqual(['bmw-3-serisi-320d']);
    expect(r.targets[0]!.exact).toBe(false);
    expect(r.targets[0]!.notes.join(' ')).toContain('paket');
  });
  it('Opel Astra 1.3 CDTI motor yolu; yalnızca Astra seri yolu; marka adı modelde olsa da', () => {
    expect(paths('Opel', 'Astra 1.3 CDTI')).toEqual(['opel-astra-1.3-cdti']);
    expect(paths('Opel', 'Astra')).toEqual(['opel-astra']);
    expect(paths('Opel', 'Opel Astra')).toEqual(['opel-astra']);
  });
  it('seri var, motor yok: seri sayfası + not', () => {
    const r = resolveVehicle('Opel', 'Astra 1.9');
    expect(r.targets.map((t) => t.path)).toEqual(['opel-astra']);
    expect(r.targets[0]!.exact).toBe(false);
    expect(r.targets[0]!.notes[0]).toContain('katalogda yok');
  });
  it('marka yok: modelden marka çıkarılır (tam seri eşleşmesi)', () => {
    expect(paths(undefined, 'Egea')).toEqual(['fiat-egea']);
    expect(paths(undefined, 'Astra')).toEqual(['opel-astra']);
    expect(paths(undefined, 'Clio')).toEqual(['renault-clio']);
  });
  it('Land Rover: SUV yolları, Range Rover karışık yazımı', () => {
    expect(paths('Land Rover', 'Discovery')).toEqual(['arazi-suv-pickup-land-rover-discovery']);
    expect(paths('Land Rover', 'Range Rover Sport')).toEqual(['arazi-suv-pickup-land-rover-range-rover-sport']);
    expect(paths('Land Rover', 'Range Rover Discovery')).toEqual(['arazi-suv-pickup-land-rover-discovery']);
    expect(paths('Range Rover', null)).toEqual(['arazi-suv-pickup-land-rover-range-rover']);
    expect(paths(undefined, 'Range Rover Evoque')).toEqual(['arazi-suv-pickup-land-rover-range-rover-evoque']);
  });
  it('yalnızca marka: markanın bulunduğu her kategori, otomobil önce', () => {
    const p = paths('Opel', null);
    expect(p[0]).toBe('opel');
    expect(p).toContain('arazi-suv-pickup-opel');
    expect(p).toContain('minivan-panelvan-opel');
    expect(paths('Land Rover', null)).toEqual(['arazi-suv-pickup-land-rover']);
  });
  it('bilinmeyen model bilinen markada: marka sayfası, mevcut serileri listeleyen not', () => {
    const r = resolveVehicle('BMW', 'Zzz');
    expect(r.targets[0]!.path).toBe('bmw');
    expect(r.notes[0]).toContain('3 Serisi');
  });
  it('seri listesi bilinmeyen markalar (VW): tek kategoride, doğrulanmadı notuyla tahmin', () => {
    const golf = resolveVehicle('Volkswagen', 'Golf');
    expect(golf.targets.map((t) => t.path)).toEqual(['volkswagen-golf']);
    expect(golf.targets[0]!.notes[0]).toContain('doğrulanmadı');
    expect(paths('Volkswagen', 'Tiguan')).toEqual(['arazi-suv-pickup-volkswagen-tiguan']);
    expect(paths(undefined, 'Tiguan')).toEqual(['arazi-suv-pickup-volkswagen-tiguan']);
    expect(paths('Volkswagen', 'Caddy')).toEqual(['minivan-panelvan-volkswagen-caddy']);
  });
  it('Mercedes GLC: otomobilde yok, SUV kategorisi tahmini (otomobil seri listesi tam)', () => {
    expect(paths('Mercedes', 'GLC')).toEqual(['arazi-suv-pickup-mercedes-benz-glc']);
  });
  it('tanınmayan marka katalog dışı: çözümsüz', () => {
    expect(resolveVehicle('Zzzmarka', 'Foo').unresolved).toBe(true);
  });
});

describe('buildSearchUrls: katalog + kategori profili', () => {
  it('BMW X5: SUV parametre kimlikleri, otomobil kimlikleri değil', () => {
    const { url } = one({ brand: 'BMW', models: ['X5'], yearMin: 2015, kmMax: 150000, fuel: 'diesel', transmission: 'automatic', bodyType: 'suv', enginePower: '226-250', engineVolume: '2501-3000' });
    expect(url.pathname).toBe('/arazi-suv-pickup-bmw-x5');
    const p = Object.fromEntries(url.searchParams);
    expect(p).toMatchObject({ a277_min: '2015', a276_max: '150000', a287: '400', a279: '33625', a107181: '1209956', a2321: '74376', a2319: '62633' });
    for (const k of ['a5_min', 'a4_max', 'a17', 'a6', 'a8', 'a2320', 'a1864']) expect(p).not.toHaveProperty(k);
  });
  it('SUV: garanti (a87472), ağır hasar, AWD -> 4x4 notuyla, birleşik hacim aralığı notu', () => {
    const r = one({ brand: 'BMW', models: ['X5'], warranty: true, noHeavyDamage: true, drivetrain: 'awd', engineVolume: '4501-5000' });
    const p = Object.fromEntries(r.url.searchParams);
    expect(p).toMatchObject({ a87472: '675082', a116446: '1263360', a95938: '10122', a2319: '62636' });
    expect(r.note).toContain('AWD ve 4WD ayrı değil');
    expect(r.note).toContain('4001-5000 cc');
  });
  it('minivan: Fiat Doblo benzeri kategori kimlikleri (a767/a766, a3807, a1847 ...)', () => {
    const [u] = urls({ brand: 'Volkswagen', models: ['Caddy'], yearMin: 2018, kmMax: 100000, transmission: 'manual', fuel: 'diesel', sellerType: 'dealer', bodyType: 'panel-van', color: 'white', drivetrain: 'fwd', noHeavyDamage: true });
    const url = new URL(u!.url);
    expect(url.pathname).toBe('/minivan-panelvan-volkswagen-caddy');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      a767_min: '2018', a766_max: '100000', a3807: '70940', a1847: '51669', a769: '37949', a96780: '1119672', a2045: '61881', a107201: '1210971', a116447: '1263362',
    });
  });
  it('kategoride karşılığı olmayan filtre eklenmez, kategori adıyla not düşer', () => {
    const r = one({ brand: 'BMW', models: ['X5'], bodyType: 'sedan', color: 'turquoise' });
    expect(r.url.searchParams.has('a107181')).toBe(false);
    expect(r.note).toContain('SUV kategorisinde');
    const m = one({ brand: 'Volkswagen', models: ['Caddy'], warranty: true, vehicleCondition: 'new' });
    expect(m.note).toContain('Minivan & Panelvan kategorisinde');
  });
  it('otomobil kimlikleri değişmedi', () => {
    const { url } = one({ brand: 'BMW', models: ['320d'], bodyType: 'sedan', enginePower: '176-200', engineVolume: '1801-2000', warranty: false, drivetrain: 'rwd' });
    expect(url.pathname).toBe('/bmw-3-serisi-320d');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ a8: '250', a2320: '74348', a1864: '51980', a4054: '72907', a9213: '136270' });
  });
  it('tanınmayan marka: tahmin yolu doğrulanmadı notuyla', () => {
    const r = one({ brand: 'Zzzmarka', models: ['Foo'] });
    expect(r.url.pathname).toBe('/zzzmarka-foo');
    expect(r.note).toContain('doğrulanmadı');
  });
});

describe('katalog öğrenme (içe aktarılan arama sayfalarından)', () => {
  const html = `<div id="searchCategoryContainer"><ul>
    <li class="cl4"><a href="/volkswagen-golf-1.6-tdi">1.6 TDi (12)</a></li>
    <li class="cl4"><a href="/volkswagen-golf-1.4-tsi">1.4 TSI</a></li>
    <li class="cl3"><a href="/volkswagen-passat">Passat</a></li>
    <li class="cl4"><a href="/otomobil/elektrik">Elektrik</a></li></ul></div>`;

  it('extractCategoryTree: sınıf, yol ve temiz metin; filtre yolları atılır', () => {
    expect(extractCategoryTree(html)).toEqual([
      { cl: 'cl4', path: 'volkswagen-golf-1.6-tdi', text: '1.6 TDi' },
      { cl: 'cl4', path: 'volkswagen-golf-1.4-tsi', text: '1.4 TSI' },
      { cl: 'cl3', path: 'volkswagen-passat', text: 'Passat' },
    ]);
    expect(extractCategoryTree('<html><body>yok</body></html>')).toEqual([]);
  });

  it('learn: seri ve motor eklenir, yol artık tahmin değil doğrulanmış', () => {
    const c = new Catalog({ generatedAt: null, categories: { otomobil: { volkswagen: { l: 'Volkswagen', s: { golf: { l: 'Golf', e: null } }, u: true } } } });
    expect(c.resolve('Volkswagen', 'Golf 1.6 TDI').targets[0]!.exact).toBe(false);
    expect(c.learn(extractCategoryTree(html))).toBe(3);
    const r = c.resolve('Volkswagen', 'Golf 1.6 TDI');
    expect(r.targets.map((t) => t.path)).toEqual(['volkswagen-golf-1.6-tdi']);
    expect(r.targets[0]!.exact).toBe(true);
    expect(c.resolve('Volkswagen', 'Passat').targets.map((t) => t.path)).toEqual(['volkswagen-passat']);
    expect(c.learn(extractCategoryTree(html))).toBe(0); // idempotent
  });

  it('CatalogLearner: diske yazar ve yeni örnekte yükler; bozuk dosya sessiz', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catlearn-'));
    const file = path.join(dir, 'catalog-learned.json');
    const mk = () => new Catalog({ generatedAt: null, categories: { otomobil: { volkswagen: { l: 'Volkswagen', s: { golf: { l: 'Golf', e: null } } } } } });
    const a = new CatalogLearner(mk(), file);
    expect(a.addFromHtml(html)).toBeGreaterThan(0);
    const c2 = mk();
    expect(new CatalogLearner(c2, file).load()).toBeGreaterThan(0);
    expect(c2.resolve('Volkswagen', 'Golf 1.4 TSI').targets[0]!.path).toBe('volkswagen-golf-1.4-tsi');
    fs.writeFileSync(file, '{bozuk');
    expect(new CatalogLearner(mk(), file).load()).toBe(0);
    fs.rmSync(dir, { recursive: true });
  });
});
