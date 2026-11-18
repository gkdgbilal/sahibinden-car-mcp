import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportProvider } from '../src/providers/import-provider.js';
import { JsonStore } from '../src/store/json-store.js';
import type { Listing, ListingSummary } from '../src/sahibinden/types.js';
import type { ToolDeps } from '../src/tools/deps.js';
import { compareCarsHandler, compareCarsInput, compareCarsOutput, computeComparison } from '../src/tools/compare-cars.js';
import { getListingHandler, getListingInput, getListingOutput } from '../src/tools/get-listing.js';
import { importListingHtmlHandler, importListingHtmlInput, importListingHtmlOutput } from '../src/tools/import-listing-html.js';
import { pingHandler, pingInput, pingOutput } from '../src/tools/ping.js';
import { searchCarsHandler, searchCarsInput, searchCarsOutput } from '../src/tools/search-cars.js';

const fxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let dir: string;
let deps: ToolDeps;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-tools-'));
  const inbox = path.join(dir, 'inbox');
  fs.mkdirSync(inbox);
  for (const f of ['search.synthetic.html', 'listing.synthetic.html']) fs.copyFileSync(path.join(fxDir, f), path.join(inbox, f));
  deps = {
    provider: new ImportProvider({ store: new JsonStore(path.join(dir, 'store.json')), inboxDir: inbox, now: () => '2026-11-18T12:00:00.000Z' }),
    nowYear: () => 2026,
  };
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('tool akışı', () => {
  it('import -> search -> get -> compare; çıktılar şemaya uyar', async () => {
    const imp = importListingHtmlOutput.parse(await importListingHtmlHandler(importListingHtmlInput.parse({}), deps));
    expect(imp.imported.reduce((n, i) => n + i.count, 0)).toBe(4);
    expect(imp.storeSize).toBe(3);

    const ping = pingOutput.parse(await pingHandler(pingInput.parse({}), deps));
    expect(ping).toMatchObject({ provider: 'import', storeSize: 3, inboxDir: path.join(dir, 'inbox') });

    const s = searchCarsOutput.parse(await searchCarsHandler(searchCarsInput.parse({ city: 'Samsun', priceMax: 800000 }), deps));
    expect(s.results.map((r) => r.price)).toEqual([710000, 780000]);
    expect(s.totalMatched).toBe(2);
    expect(s).toMatchObject({ appliedFilters: ['city', 'priceMax'], urlOnlyFilters: [], excludedOtherCurrency: 0, excludedUnknown: 0 });
    const combo = searchCarsOutput.parse(
      await searchCarsHandler(searchCarsInput.parse({ city: 'Samsun', fuel: 'diesel', bodyType: 'hatchback-5-door', unknown: 'exclude' }), deps),
    );
    expect(combo.results.map((r) => r.id)).toEqual(['1000000001']);
    expect(combo.excludedUnknown).toBe(2);
    const all = searchCarsOutput.parse(await searchCarsHandler(searchCarsInput.parse({ models: ['golf'], sort: 'price_desc' }), deps));
    expect(all.results.map((r) => r.id)).toEqual(['1000000001']);

    const byId = getListingOutput.parse(await getListingHandler(getListingInput.parse({ ref: '1000000001' }), deps));
    expect(byId.found).toBe(true);
    expect(byId.listing?.damage).toHaveLength(4);
    const byUrl = getListingOutput.parse(
      await getListingHandler(getListingInput.parse({ ref: 'https://www.sahibinden.com/ilan/vasita-otomobil-opel-astra-ornek-bakimli-1000000002/detay' }), deps),
    );
    expect(byUrl).toMatchObject({ found: true, listing: null });
    expect(byUrl.summary?.id).toBe('1000000002');
    expect(byUrl.hint).toContain('detay');
    const none = getListingOutput.parse(await getListingHandler(getListingInput.parse({ ref: '9999999999' }), deps));
    expect(none).toMatchObject({ found: false, listing: null, summary: null });
    expect(none.hint).toContain('/ilan/9999999999/detay');

    const c = compareCarsOutput.parse(
      await compareCarsHandler(compareCarsInput.parse({ refs: ['1000000001', '1000000002', '1000000003', '9999999999'] }), deps),
    );
    expect(c.missing).toEqual(['9999999999']);
    expect(c.rows.map((r) => r.completeness)).toEqual(['full', 'summary', 'summary']);
    expect(c.stats).toEqual({ priceMin: 710000, priceMedian: 780000, priceMax: 875000, count: 3 });
    expect(c.rows.map((r) => r.priceVsSetMedianPct)).toEqual([12.2, 0, -9]);
    expect(c.rows[0]).toMatchObject({ changedParts: 1, paintedParts: 3, tramerAmount: 12500, heavyDamage: false, ageYears: 10, kmPerYear: 12500 });
    expect(c.rows[1]).toMatchObject({ changedParts: null, tramerAmount: null });
  });

  it('inbox dışı path ve path+html birlikte hata', async () => {
    await expect(importListingHtmlHandler(importListingHtmlInput.parse({ path: path.join(fxDir, 'search.synthetic.html') }), deps)).rejects.toThrow(/inbox/);
    await expect(importListingHtmlHandler(importListingHtmlInput.parse({ path: 'a.html', html: '<p/>' }), deps)).rejects.toThrow(/birlikte/);
  });

  it('zod girdi doğrulama', () => {
    expect(compareCarsInput.safeParse({ refs: ['x'] }).success).toBe(false);
    expect(searchCarsInput.safeParse({ limit: 0 }).success).toBe(false);
    expect(importListingHtmlInput.safeParse({ sourceUrl: 'degil' }).success).toBe(false);
    expect(getListingInput.safeParse({ ref: 'x' }).success).toBe(false);
  });
});

describe('computeComparison', () => {
  const mk = (o: Partial<ListingSummary>): ListingSummary => ({
    id: 'i', url: 'u', title: 't', brand: null, series: null, model: null, year: 2020, km: 60000, color: null,
    price: 100, currency: 'TL', city: null, district: null, listingDate: null, transmission: null, fuel: null,
    source: 'search', capturedAt: 'x', ...o,
  });

  it('çift sayıda medyan ve yuvarlama', () => {
    const r = computeComparison([mk({ price: 100 }), mk({ price: 200 }), mk({ price: 300 }), mk({ price: 400 })], 2026);
    expect(r.stats).toEqual({ priceMin: 100, priceMedian: 250, priceMax: 400, count: 4 });
    expect(r.rows.map((x) => x.priceVsSetMedianPct)).toEqual([-60, -20, 20, 60]);
    expect(r.rows[0]).toMatchObject({ ageYears: 6, kmPerYear: 10000 });
  });

  it('null değerler ve gelecek yıl', () => {
    const r = computeComparison([mk({ price: null, year: null, km: null }), mk({ year: 2027, km: 500 })], 2026);
    expect(r.rows[0]).toMatchObject({ ageYears: null, kmPerYear: null, priceVsSetMedianPct: null });
    expect(r.rows[1]).toMatchObject({ ageYears: 0, kmPerYear: 500, priceVsSetMedianPct: 0 });
  });

  it('farklı para birimi: çoğunluk medyanı, diğeri null', () => {
    const r = computeComparison([mk({ price: 100 }), mk({ price: 300 }), mk({ price: 5, currency: 'EUR' }), mk({ price: 9, currency: null })], 2026);
    expect(r.stats.priceMedian).toBe(200);
    expect(r.rows.map((x) => x.priceVsSetMedianPct)).toEqual([-50, 50, null, null]);
  });

  it('hasar sayıları ve eksik damage', () => {
    const full = { ...mk({ source: 'listing' }), engine: null, bodyType: null, drivetrain: null, vehicleCondition: null,
      sellerType: null, exchange: null, warranty: null, heavyDamage: true, tramerAmount: 5, description: null,
      attributes: {}, warnings: [],
      damage: [{ part: 'a', status: 'changed' }, { part: 'b', status: 'local-painted' }, { part: 'c', status: 'original' }] } as Listing;
    const r = computeComparison([full, { ...full, damage: null }], 2026);
    expect(r.rows[0]).toMatchObject({ changedParts: 1, paintedParts: 1, heavyDamage: true, completeness: 'full' });
    expect(r.rows[1]).toMatchObject({ changedParts: null, paintedParts: null });
  });

  it('boş giriş', () => {
    expect(computeComparison([], 2026).stats).toEqual({ priceMin: null, priceMedian: null, priceMax: null, count: 0 });
  });
});
