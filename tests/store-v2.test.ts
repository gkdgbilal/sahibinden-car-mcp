import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSearchPage } from '../src/sahibinden/parser.js';
import type { ListingSummary } from '../src/sahibinden/types.js';
import { JsonStore } from '../src/store/json-store.js';
import {
  derivePriceHistory, insertObservation, migrateV1, observationKey,
} from '../src/store/schema.js';
import type { Observation, StoreDataV1 } from '../src/store/schema.js';

const fxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (n: string) => fs.readFileSync(path.join(fxDir, n), 'utf8');
const v1Fixture = (): StoreDataV1 => JSON.parse(fx('store.v1.json')) as StoreDataV1;

const T1 = '2026-11-10T09:00:00.000Z';
const T2 = '2026-11-14T09:00:00.000Z';
const MIGRATED_AT = '2026-11-18T12:00:00.000Z';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-store2-'));
  file = path.join(dir, 'store.json');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const baseItem = (): ListingSummary => parseSearchPage(fx('search.synthetic.html'), { capturedAt: T1 }).items[0]!;
const at = (item: ListingSummary, price: number, capturedAt: string): ListingSummary => ({ ...item, price, capturedAt });

describe('migrateV1', () => {
  it('her fiyat noktası approx gözlem; özet/detay korunur; watchlist/searches boş', () => {
    const v1 = v1Fixture();
    const v2 = migrateV1(v1, MIGRATED_AT);
    expect(v2.version).toBe(2);
    expect(v2.migratedFrom).toBe(1);
    expect(v2.migratedAt).toBe(MIGRATED_AT);
    expect(v2.searches).toEqual({});
    expect(v2.watchlist).toEqual({});
    expect(Object.keys(v2.listings)).toEqual(Object.keys(v1.listings));
    expect(v2.importedFiles).toEqual(v1.importedFiles);

    const e = v2.listings['1000000001']!;
    expect(e.summary).toEqual(v1.listings['1000000001']!.summary);
    expect(e.listing).toEqual(v1.listings['1000000001']!.listing);
    expect(e.observations!.length).toBeGreaterThanOrEqual(2);
    expect(e.observations!.every((o) => o.approx === true)).toBe(true);
    for (const p of v1.listings['1000000001']!.priceHistory) {
      expect(e.observations!.some((o) => o.at === p.capturedAt && o.price === p.price && o.currency === p.currency)).toBe(true);
    }
    expect(e.priceHistory).toEqual(v1.listings['1000000001']!.priceHistory);
    // EUR ilan para birimini korur
    expect(v2.listings['1000000003']!.observations![0]).toMatchObject({ currency: 'EUR', price: 15500, approx: true });
  });

  it('girdiyi değiştirmez; ikinci çağrı aynı sonucu verir', () => {
    const v1 = v1Fixture();
    const snapshot = JSON.stringify(v1);
    const a = migrateV1(v1, MIGRATED_AT);
    const b = migrateV1(v1, MIGRATED_AT);
    expect(JSON.stringify(v1)).toBe(snapshot);
    expect(b).toEqual(a);
  });
});

describe('JsonStore v1 -> v2', () => {
  it('v1 dosya yüklenir; save() yedek yazar ve version 2 yazar; ikinci save() yedeğe dokunmaz', () => {
    const original = fx('store.v1.json');
    fs.writeFileSync(file, original);
    const s = new JsonStore(file, { now: () => MIGRATED_AT });
    expect(s.size()).toBe(3);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(1); // yüklemek yazmaz
    expect(fs.existsSync(path.join(dir, 'store.v1-backup.json'))).toBe(false);

    s.save();
    expect(fs.readFileSync(path.join(dir, 'store.v1-backup.json'), 'utf8')).toBe(original);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(written.version).toBe(2);
    expect(written.migratedFrom).toBe(1);
    expect(written.migratedAt).toBe(MIGRATED_AT);

    s.upsertSummary(at(baseItem(), 123456, '2026-11-17T09:00:00.000Z'));
    s.save();
    expect(fs.readFileSync(path.join(dir, 'store.v1-backup.json'), 'utf8')).toBe(original);

    // yeniden açma: v2'dir, yedek tekrar yazılmaz / değişmez
    fs.writeFileSync(path.join(dir, 'store.v1-backup.json'), 'DEGISTI');
    const again = new JsonStore(file);
    again.upsertSummary(at(baseItem(), 123457, '2026-11-18T09:00:00.000Z'));
    again.save();
    expect(fs.readFileSync(path.join(dir, 'store.v1-backup.json'), 'utf8')).toBe('DEGISTI');
  });

  it('zaten yedek varsa (v1 yeniden taşınsa bile) yedeğin üzerine yazılmaz', () => {
    fs.writeFileSync(file, fx('store.v1.json'));
    fs.writeFileSync(path.join(dir, 'store.v1-backup.json'), 'ONCEKI');
    const s = new JsonStore(file);
    s.size();
    s.save();
    expect(fs.readFileSync(path.join(dir, 'store.v1-backup.json'), 'utf8')).toBe('ONCEKI');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(2);
  });

  it('taşınan veri v2 olarak yeniden okunur ve fiyat geçmişi aynı kalır', () => {
    fs.writeFileSync(file, fx('store.v1.json'));
    const s = new JsonStore(file);
    s.size();
    s.save();
    const r = new JsonStore(file);
    expect(r.size()).toBe(3);
    expect(r.get('1000000001')!.priceHistory.map((p) => p.price)).toEqual([875000, 850000]);
    expect(r.record('1000000001')!.full).toBe(true);
    expect(r.searches()).toEqual({});
    expect(r.watchlist()).toEqual({});
  });

  it('version 3: "daha yeni bir sürüm" hatası, dosya değişmez', () => {
    const raw = JSON.stringify({ version: 3, listings: {}, importedFiles: {} });
    fs.writeFileSync(file, raw);
    const s = new JsonStore(file);
    expect(() => s.size()).toThrow(/daha yeni bir sürümle/);
    expect(() => s.save()).toThrow(/daha yeni bir sürümle/);
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    expect(fs.existsSync(path.join(dir, 'store.v1-backup.json'))).toBe(false);
  });

  it('tanınmayan sürüm hata; v2 dosyada eksik searches/watchlist doldurulur', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 0, listings: {} }));
    expect(() => new JsonStore(file).size()).toThrow(/tanınmayan/);
    fs.writeFileSync(file, JSON.stringify({ version: 2, listings: {} }));
    const s = new JsonStore(file);
    expect(s.searches()).toEqual({});
    expect(s.watchlist()).toEqual({});
  });
});

describe('gözlem modeli (B2 regresyonu)', () => {
  it('eski gözlem sonradan gelse de sıra doğru, anlık görüntü yeniyi korur; tekrar eklemek değiştirmez', () => {
    const s = new JsonStore(file);
    const item = baseItem();
    const A = at(item, 800000, T1);
    const B = at(item, 750000, T2);
    s.upsertSummary(B);
    s.upsertSummary(A);
    expect(s.get(item.id)!.priceHistory).toEqual([
      { price: 800000, currency: 'TL', capturedAt: T1 },
      { price: 750000, currency: 'TL', capturedAt: T2 },
    ]);
    expect(s.get(item.id)!.summary!.price).toBe(750000);
    expect(s.get(item.id)!.observations).toHaveLength(2);

    // aynı gözlemler tekrar (parser yükseltmesi / force): her sırada
    s.upsertSummary(A);
    s.upsertSummary(B);
    s.upsertSummary(A);
    expect(s.get(item.id)!.observations).toHaveLength(2);
    expect(s.get(item.id)!.priceHistory).toHaveLength(2);
    expect(s.get(item.id)!.summary!.price).toBe(750000);
  });

  it('tekrar okuma sahte düşüş üretmez: [800k, 750k] iki kez yeniden oynatılınca aynı', () => {
    const s = new JsonStore(file);
    const item = baseItem();
    const seq = [at(item, 800000, T1), at(item, 750000, T2)];
    for (let i = 0; i < 3; i++) for (const o of seq) s.upsertSummary(o);
    expect(s.get(item.id)!.priceHistory.map((p) => p.price)).toEqual([800000, 750000]);
    expect(s.get(item.id)!.observations).toHaveLength(2);
  });

  it('aynı fiyat iki farklı zamanda: priceHistory tek nokta, gözlem 2', () => {
    const s = new JsonStore(file);
    const item = baseItem();
    s.upsertSummary(at(item, 800000, T1));
    s.upsertSummary(at(item, 800000, T2));
    expect(s.get(item.id)!.priceHistory).toEqual([{ price: 800000, currency: 'TL', capturedAt: T1 }]);
    expect(s.get(item.id)!.observations).toHaveLength(2);
  });

  it('v1\'den taşınan approx gözlem yeni içe aktarmanın anlık görüntüsünü engellemez', () => {
    fs.writeFileSync(file, fx('store.v1.json'));
    const s = new JsonStore(file);
    const v1sum = s.get('1000000002')!.summary!;
    const fresh = { ...v1sum, price: 700000, capturedAt: '2026-11-01T09:00:00.000Z' }; // approx T1'den eski ama approx engel değil
    s.upsertSummary(fresh);
    expect(s.get('1000000002')!.summary!.price).toBe(700000);
  });

  it('detay ve özet gözlemleri ayrı türde; detay anlık görüntüsü özetten etkilenmez', () => {
    fs.writeFileSync(file, fx('store.v1.json'));
    const t = new JsonStore(file);
    const l = t.get('1000000001')!.listing!;
    t.upsertSummary(at(t.get('1000000001')!.summary!, 700000, '2026-11-17T09:00:00.000Z'));
    expect(t.get('1000000001')!.listing).toEqual(l);
    expect(t.get('1000000001')!.summary!.price).toBe(700000);
  });

  it('gözlem bağlamı: searchKey ve filters yalnızca özet gözleminde; filtresiz bağlamda alan yok', () => {
    const s = new JsonStore(file);
    const item = baseItem();
    s.upsertSummary(at(item, 800000, T1), { searchKey: '/x?a=1', filters: ['unpainted'] });
    s.upsertSummary(at(item, 800000, T2), { searchKey: '/x?*', filters: [] });
    const obs = s.record(item.id)!.observations;
    expect(obs[0]).toMatchObject({ kind: 'search', searchKey: '/x?a=1', filters: ['unpainted'] });
    expect(obs[1]!.filters).toBeUndefined();
    expect(obs[1]!.searchKey).toBe('/x?*');
  });
});

describe('gözlem sınırı (200)', () => {
  const mk = (i: number, price: number): Observation => ({
    at: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
    kind: 'search',
    price,
    currency: 'TL',
    searchKey: '/x?*',
  });

  it('250 gözlem -> 200; koşu sınırları ve en yeni korunur', () => {
    // 3 koşu: 100x 900k, 100x 850k, 50x 800k (i = 0..249)
    const all: Observation[] = [];
    for (let i = 0; i < 250; i++) all.push(mk(i, i < 100 ? 900000 : i < 200 ? 850000 : 800000));
    let list: Observation[] = [];
    for (const o of all) list = insertObservation(list, o).list;
    expect(list).toHaveLength(200);
    const ats = new Set(list.map((o) => o.at));
    for (const i of [0, 99, 100, 199, 200, 249]) expect(ats.has(all[i]!.at)).toBe(true);
    // sıralı ve fiyat dizisi bozulmadı
    expect(list.map((o) => o.at)).toEqual([...list.map((o) => o.at)].sort());
    expect(derivePriceHistory(list).map((p) => p.price)).toEqual([900000, 850000, 800000]);
    // en eski iç noktalar atıldı: 1. gözlem kaldı, 2. gitti
    expect(ats.has(all[1]!.at)).toBe(false);
  });

  it('iç nokta yoksa en eski atılır, en yeni kalır', () => {
    let list: Observation[] = [];
    for (let i = 0; i < 205; i++) list = insertObservation(list, mk(i, i % 2 === 0 ? 100 : 200)).list;
    expect(list).toHaveLength(200);
    expect(list[list.length - 1]!.at).toBe(mk(204, 100).at);
  });

  it('mağaza düzeyinde 250 gözlem -> 200', () => {
    const s = new JsonStore(file);
    const item = baseItem();
    for (let i = 0; i < 250; i++) s.upsertSummary({ ...item, price: 1000 + (i < 125 ? 0 : 1), capturedAt: mk(i, 0).at });
    expect(s.get(item.id)!.observations).toHaveLength(200);
    expect(s.get(item.id)!.priceHistory.map((p) => p.price)).toEqual([1000, 1001]);
  });

  it('gözlem anahtarı kind|at|searchKey', () => {
    expect(observationKey(mk(0, 1))).toBe(`search|${mk(0, 1).at}|/x?*`);
  });
});

describe('arama kayıtları ve izleme listesi', () => {
  it('recordSearch: first=min, last=max; totalCount/sorting en yeni gözlemden', () => {
    const s = new JsonStore(file);
    const base = { path: '/x', category: 'x', filters: [] as never[], filtersKnown: true };
    s.recordSearch('/x?a=1', { ...base, sorting: 'price_asc', totalCount: 100, at: T2 });
    s.recordSearch('/x?a=1', { ...base, sorting: 'date_desc', totalCount: 90, at: T1 }); // daha eski
    expect(s.searches()['/x?a=1']).toMatchObject({
      firstObservedAt: T1, lastObservedAt: T2, totalCount: 100, sorting: 'price_asc',
    });
    s.recordSearch('/x?a=1', { ...base, sorting: null, totalCount: 80, at: '2026-11-17T09:00:00.000Z' });
    expect(s.searches()['/x?a=1']).toMatchObject({
      firstObservedAt: T1, lastObservedAt: '2026-11-17T09:00:00.000Z', totalCount: 80, sorting: null,
    });
    s.save();
    expect(new JsonStore(file).searches()['/x?a=1']!.totalCount).toBe(80);
  });

  it('watchUpsert/watchRemove ve kalıcılık', () => {
    const s = new JsonStore(file);
    const w = s.watchUpsert('1000000001', { priceAtAdd: 875000, currencyAtAdd: 'TL', note: 'bak' }, T1);
    expect(w).toEqual({ addedAt: T1, updatedAt: T1, priceAtAdd: 875000, currencyAtAdd: 'TL', note: 'bak' });
    const w2 = s.watchUpsert('1000000001', {}, T2);
    expect(w2).toMatchObject({ addedAt: T1, updatedAt: T2, note: 'bak', priceAtAdd: 875000 });
    expect(s.watchUpsert('1000000001', { note: '' }, T2).note).toBeUndefined();
    s.save();
    expect(new JsonStore(file).watchlist()['1000000001']).toMatchObject({ addedAt: T1, priceAtAdd: 875000 });
    expect(s.watchRemove('1000000001')).toBe(true);
    expect(s.watchRemove('1000000001')).toBe(false);
  });

  it('watchlist, dosya başka süreçte değiştiyse (kirli değilse) yeniden yüklenir', () => {
    const a = new JsonStore(file);
    a.upsertSummary(baseItem());
    a.save();
    expect(a.watchlist()).toEqual({});
    const b = new JsonStore(file);
    b.watchUpsert('1000000001', { priceAtAdd: 1, currencyAtAdd: 'TL' }, T1);
    b.save();
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(file, t, t);
    expect(Object.keys(a.watchlist())).toEqual(['1000000001']);
  });

  it('kirli (kaydedilmemiş değişiklik) varken yeniden yükleme yapılmaz', () => {
    const a = new JsonStore(file);
    a.upsertSummary(baseItem());
    a.save();
    a.watchUpsert('1000000001', { priceAtAdd: 1, currencyAtAdd: 'TL' }, T1); // kirli
    const b = new JsonStore(file);
    b.watchUpsert('1000000009', { priceAtAdd: 2, currencyAtAdd: 'TL' }, T1);
    b.save();
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(file, t, t);
    expect(Object.keys(a.watchlist())).toEqual(['1000000001']);
  });

  it('records()/record(): best = detay ?? özet, full bayrağı, gözlemler sıralı', () => {
    fs.writeFileSync(file, fx('store.v1.json'));
    const s = new JsonStore(file);
    expect(s.records().map((r) => r.id).sort()).toEqual(['1000000001', '1000000002', '1000000003']);
    const r1 = s.record('1000000001')!;
    expect(r1.full).toBe(true);
    expect(r1.best.source).toBe('listing');
    expect(s.record('1000000002')!.full).toBe(false);
    expect(s.record('9999999999')).toBeUndefined();
    const times = r1.observations.map((o) => Date.parse(o.at));
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });
});
