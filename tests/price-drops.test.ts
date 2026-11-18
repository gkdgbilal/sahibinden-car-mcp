import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportProvider } from '../src/providers/import-provider.js';
import { JsonStore } from '../src/store/json-store.js';
import type { RecordView } from '../src/store/schema.js';
import { getListingHandler, getListingInput, getListingOutput } from '../src/tools/get-listing.js';
import { importListingHtmlHandler, importListingHtmlInput } from '../src/tools/import-listing-html.js';
import { priceDropsHandler, priceDropsInput, priceDropsOutput } from '../src/tools/price-drops.js';
import { listing, memStore, NOW, ob, searchInfo, summary, view } from './helpers/views.js';

const run = async (store: ReturnType<typeof memStore>, input: object = {}) =>
  priceDropsOutput.parse(await priceDropsHandler(priceDropsInput.parse(input), { store, now: () => NOW }));

/** 745k -> 715k (%4,0) */
const dropper = (id: string, to = 715000, best: Parameters<typeof view>[2] = {}) =>
  view(id, [ob(745000, '2026-10-20'), ob(to, '2026-11-09')], best);

describe('price_drops girdi', () => {
  it('varsayılanlar: 30 gün, %3, notSeenDays 14, limit 20', () => {
    expect(priceDropsInput.parse({})).toEqual({
      withinDays: 30, minDropPct: 3, minDropTl: 0, watchlistOnly: false, includeNotSeen: false, notSeenDays: 14, limit: 20,
    });
    expect(priceDropsInput.safeParse({ withinDays: 0 }).success).toBe(false);
    expect(priceDropsInput.safeParse({ filter: { category: 'Opel Astra' } }).success).toBe(false);
  });
});

describe('priceDropsHandler', () => {
  it('düşüşü bulur; çıktı şemaya uyar; sayaçlar ve pencere', async () => {
    const out = await run(memStore([dropper('1'), view('2', [ob(700000, '2026-11-01')]), view('3', [ob(745000, '2026-10-20'), ob(760000, '2026-11-09')])]));
    expect(out.drops.map((d) => d.id)).toEqual(['1']);
    expect(out.drops[0]).toMatchObject({ dropTl: 30000, dropPct: 4, watched: false, flags: ['summary-only'] });
    expect(out.counts).toEqual({ scanned: 3, matchedFilter: 3, withPriceChange: 2, excludedOtherCurrency: 0, excludedCurrencyChange: 0 });
    expect(out.window).toEqual({ from: '2026-10-19T12:00:00.000Z', to: '2026-11-18T12:00:00.000Z' });
    expect(out.notSeen).toBeUndefined();
    expect(out.notes.join(' ')).toContain('istek');
  });

  it('boş store: hata değil, boş sonuç + not', async () => {
    const out = await run(memStore([]));
    expect(out.drops).toEqual([]);
    expect(out.notes[0]).toContain('Store boş');
    expect(out.counts.scanned).toBe(0);
  });

  it('6. TL dışı ayrı sayılır, düşüş olarak karışmaz; para birimi değişen bayraklı', async () => {
    const eur = view('1', [ob(20000, '2026-10-20', { currency: 'EUR' }), ob(15000, '2026-11-09', { currency: 'EUR' })]);
    const mixed = view('2', [ob(750000, '2026-10-20'), ob(15000, '2026-11-02', { currency: 'EUR' }), ob(700000, '2026-11-09')]);
    const out = await run(memStore([eur, mixed]));
    expect(out.drops.map((d) => d.id)).toEqual(['2']);
    expect(out.drops[0]!.flags).toContain('currency-changed');
    expect(out.counts).toMatchObject({ excludedOtherCurrency: 1, excludedCurrencyChange: 1 });
    expect(out.notes.join(' ')).toContain('TL dışı');
  });

  it('8. izlenen önce; watchlistOnly yalnız izlenenler; not taşınır', async () => {
    const views = [dropper('1', 600000), dropper('2', 715000), dropper('3', 700000)];
    const watch = { '2': { addedAt: 'x', updatedAt: 'x', note: 'Kaporta sorulacak', priceAtAdd: null, currencyAtAdd: null } };
    const all = await run(memStore(views, {}, watch));
    expect(all.drops.map((d) => d.id)).toEqual(['2', '1', '3']);
    expect(all.drops[0]).toMatchObject({ watched: true, note: 'Kaporta sorulacak' });
    expect(all.drops[1]!.note).toBeUndefined();
    const only = await run(memStore(views, {}, watch), { watchlistOnly: true });
    expect(only.drops.map((d) => d.id)).toEqual(['2']);
    expect(only.counts.matchedFilter).toBe(1);
  });

  it('eşitlikte düşüşü daha yeni olan önce; limit', async () => {
    const a = view('1', [ob(1000000, '2026-10-20'), ob(900000, '2026-11-05')]);
    const b = view('2', [ob(1000000, '2026-10-20'), ob(900000, '2026-11-10')]);
    expect((await run(memStore([a, b]))).drops.map((d) => d.id)).toEqual(['2', '1']);
    expect((await run(memStore([a, b]), { limit: 1 })).drops).toHaveLength(1);
  });

  it('filter: şehir/yıl/km (unknown include) ve category', async () => {
    const views = [
      dropper('1', 715000, { city: 'Samsun', year: 2011 }),
      dropper('2', 715000, { city: 'Ankara', year: 2011 }),
      dropper('3', 715000, { city: 'Samsun', year: 2015 }),
      dropper('4', 715000, { city: null, year: 2011 }), // şehir bilinmiyor -> include
    ];
    const out = await run(memStore(views), { filter: { city: 'Samsun', yearMin: 2010, yearMax: 2012 } });
    expect(out.drops.map((d) => d.id).sort()).toEqual(['1', '4']);
    expect(out.counts.matchedFilter).toBe(2);

    const withCat = [
      { ...dropper('1'), observations: [ob(745000, '2026-10-20', { searchKey: 'k' }), ob(715000, '2026-11-09', { searchKey: 'k' })] },
      dropper('2'),
    ];
    const c = await run(memStore(withCat, { k: searchInfo({ category: 'opel-astra-1.3-cdti' }) }), {
      filter: { category: 'opel-astra-1.3-cdti' },
    });
    expect(c.drops.map((d) => d.id)).toEqual(['1']);
  });

  it('9. approx gözlem approximate-dates bayrağı + açıklama notu', async () => {
    const v = view('1', [ob(745000, '2026-10-20', { approx: true }), ob(715000, '2026-11-09', { approx: true })]);
    const out = await run(memStore([v]));
    expect(out.drops[0]!.flags).toContain('approximate-dates');
    expect(out.drops[0]!.lifecycle.approximate).toBe(true);
    expect(out.notes.join(' ')).toContain('approximate-dates');
  });

  it('yaşam döngüsü: görülmeyen ilan düşüşte bayraklanır; includeNotSeen yalnız yeniden kaydedilmiş aramalarda listeler', async () => {
    const K = '/opel-astra-1.3-cdti?unpaintedParts=true';
    const K2 = '/opel-astra-1.3-cdti?*';
    const gone = view('1', [ob(745000, '2026-10-29', { searchKey: K }), ob(715000, '2026-10-29T13:00:00.000Z', { searchKey: K })]);
    const unknownCtx = view('2', [ob(745000, '2026-10-29', { searchKey: K2 })]);
    const searches = {
      [K]: searchInfo({ lastObservedAt: '2026-11-15T12:00:00.000Z' }),
      [K2]: searchInfo({ filtersKnown: false, lastObservedAt: '2026-11-15T12:00:00.000Z' }),
    };
    const out = await run(memStore([gone, unknownCtx], searches), { includeNotSeen: true });
    expect(out.drops.map((d) => d.id)).toEqual(['1']);
    expect(out.drops[0]!.flags).toContain('not-seen-recently');
    expect(out.drops[0]!.lifecycle).toMatchObject({ status: 'not-seen-recently', daysSinceLastSeen: 19, recheckedAt: '2026-11-15T12:00:00.000Z' });
    expect(out.notSeen!.map((n) => n.id)).toEqual(['1']);
    expect(out.notSeen![0]).toMatchObject({ lastPrice: 715000 });
    expect(out.notSeen![0]!.note).toContain('kaldırılmış olabilir');
    expect(out.notes.join(' ')).toMatch(/1 ilan son 14 gündür görülmedi ancak.*bilinmiyor/);
    expect(JSON.stringify(out)).not.toMatch(/satıldı|kaldırıldı/);
    // includeNotSeen kapalıyken notSeen alanı yok
    expect((await run(memStore([gone], searches))).notSeen).toBeUndefined();
    // notSeenDays büyükse görülmüş sayılır
    const wide = await run(memStore([gone], searches), { includeNotSeen: true, notSeenDays: 30 });
    expect(wide.notSeen).toEqual([]);
  });

  it('10. çıktıda satıcı/kişisel alan yok', async () => {
    const full: RecordView = {
      id: '1', full: true,
      best: listing('1', {
        sellerType: 'owner', description: 'Satıcı: Ayşe Örnek 0532 000 00 00', attributes: { Satıcı: 'Ayşe Örnek' },
        price: 715000,
      }),
      observations: [ob(745000, '2026-10-20'), ob(715000, '2026-11-09')],
    };
    const out = await run(memStore([full]));
    expect(out.drops).toHaveLength(1);
    const text = JSON.stringify(out);
    expect(text).not.toContain('Ayşe');
    expect(text).not.toContain('0532');
    expect(text).not.toContain('seller');
    expect(out.drops[0]!.flags).not.toContain('summary-only');
  });
});

describe('get_listing.tracking', () => {
  const fxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
  let dir: string;
  let store: JsonStore;
  let provider: ImportProvider;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-track-'));
    const inbox = path.join(dir, 'inbox');
    fs.mkdirSync(inbox);
    for (const f of ['search.synthetic.html', 'listing.synthetic.html']) fs.copyFileSync(path.join(fxDir, f), path.join(inbox, f));
    store = new JsonStore(path.join(dir, 'store.json'));
    provider = new ImportProvider({ store, inboxDir: inbox, now: () => '2026-11-18T12:00:00.000Z' });
    await importListingHtmlHandler(importListingHtmlInput.parse({}), { provider });
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('11. store ile tracking dolu; store\'suz çağrıda yok', async () => {
    store.watchUpsert('1000000001', { note: 'bak' }, '2026-11-18T12:00:00.000Z');
    const withStore = getListingOutput.parse(
      await getListingHandler(getListingInput.parse({ ref: '1000000001' }), { provider, store, now: () => NOW }),
    );
    expect(withStore.tracking).toBeDefined();
    expect(withStore.tracking!.lifecycle).toMatchObject({ status: 'seen-recently', daysSinceLastSeen: 0 });
    expect(withStore.tracking!.priceHistory.length).toBeGreaterThanOrEqual(1);
    expect(withStore.tracking!.priceHistory[0]).toMatchObject({ currency: 'TL' });
    expect(withStore.tracking).toMatchObject({ watched: true, note: 'bak' });

    const without = getListingOutput.parse(await getListingHandler(getListingInput.parse({ ref: '1000000001' }), { provider }));
    expect(without.found).toBe(true);
    expect(without.tracking).toBeUndefined();
    expect('tracking' in without).toBe(false);

    const missing = getListingOutput.parse(
      await getListingHandler(getListingInput.parse({ ref: '9999999999' }), { provider, store, now: () => NOW }),
    );
    expect(missing.tracking).toBeUndefined();
  });

  it('gerçek store: fiyat değişimi tracking.priceHistory ve price_drops ile uyumlu', async () => {
    const base = summary('1000000009', { price: 745000, capturedAt: '2026-10-20T12:00:00.000Z' });
    store.upsertSummary(base);
    store.upsertSummary({ ...base, price: 715000, capturedAt: '2026-11-09T12:00:00.000Z' });
    // eski dosyanın tekrar okunması sahte düşüş/artış üretmez
    store.upsertSummary(base);
    const g = getListingOutput.parse(await getListingHandler({ ref: '1000000009' }, { provider, store, now: () => NOW }));
    expect(g.tracking!.priceHistory.map((p) => p.price)).toEqual([745000, 715000]);
    const out = priceDropsOutput.parse(await priceDropsHandler(priceDropsInput.parse({ filter: { yearMin: 2011 } }), { store, now: () => NOW }));
    expect(out.drops.map((d) => d.id)).toContain('1000000009');
    expect(out.drops.find((d) => d.id === '1000000009')).toMatchObject({ dropTl: 30000, dropPct: 4 });
  });
});
