import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportProvider } from '../src/providers/import-provider.js';
import { parseRef } from '../src/providers/provider.js';
import { SearchQuerySchema } from '../src/sahibinden/types.js';
import { JsonStore } from '../src/store/json-store.js';

const fxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const NOW = '2026-11-18T12:00:00.000Z';

let dir: string;
let inbox: string;
let provider: ImportProvider;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-prov-'));
  inbox = path.join(dir, 'inbox');
  fs.mkdirSync(inbox);
  provider = new ImportProvider({ store: new JsonStore(path.join(dir, 'store.json')), inboxDir: inbox, now: () => NOW });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const copy = (name: string, as = name) => fs.copyFileSync(path.join(fxDir, name), path.join(inbox, as));

describe('parseRef', () => {
  it('ilan no ve URL biçimleri', () => {
    expect(parseRef('1000000001')).toBe('1000000001');
    expect(parseRef(' https://www.sahibinden.com/ilan/vasita-otomobil-volkswagen-golf-x-1000000001/detay?a=1 ')).toBe('1000000001');
    expect(parseRef('https://www.sahibinden.com/ilan/1000000001/detay')).toBe('1000000001');
    expect(parseRef('x')).toBeNull();
    expect(parseRef('123')).toBeNull();
  });
});

describe('ImportProvider.ingest', () => {
  it('inbox: 3 özet + 1 detay; challenge ve .txt atlanır; ikinci çalıştırma duplicate', async () => {
    copy('search.synthetic.html');
    copy('listing.synthetic.html');
    copy('challenge.html');
    fs.writeFileSync(path.join(inbox, 'not.txt'), 'x');
    const r = await provider.ingest({});
    expect(r.imported.map((i) => [path.basename(i.file!), i.pageType, i.count])).toEqual([
      ['listing.synthetic.html', 'listing', 1],
      ['search.synthetic.html', 'search', 3],
    ]);
    expect(r.skipped.map((s) => path.basename(s.file!))).toEqual(['challenge.html']);
    expect(r.skipped[0]!.reason).toContain('Cloudflare');
    expect(r.storeSize).toBe(3);

    const again = await provider.ingest({});
    expect(again.imported).toEqual([]);
    expect(again.skipped.map((s) => s.reason).filter((x) => x === 'duplicate')).toHaveLength(2);
    expect(again.skipped).toHaveLength(3);
  });

  it('tek dosya path: .txt not-html, göreli yol inbox\'a göre', async () => {
    fs.writeFileSync(path.join(inbox, 'not.txt'), 'x');
    expect((await provider.ingest({ path: 'not.txt' })).skipped).toEqual([{ file: path.join(inbox, 'not.txt'), reason: 'not-html' }]);
    copy('search.synthetic.html');
    expect((await provider.ingest({ path: 'search.synthetic.html' })).imported[0]!.count).toBe(3);
  });

  it('alt klasöre inmez; unknown sayfa ve sembolik link atlanır', async () => {
    fs.mkdirSync(path.join(inbox, 'sub'));
    fs.copyFileSync(path.join(fxDir, 'search.synthetic.html'), path.join(inbox, 'sub', 'a.html'));
    fs.writeFileSync(path.join(inbox, 'u.html'), '<html><body>merhaba</body></html>');
    fs.symlinkSync(path.join(fxDir, 'search.synthetic.html'), path.join(inbox, 'l.html'));
    const r = await provider.ingest({});
    expect(r.imported).toEqual([]);
    expect(r.skipped.map((s) => [path.basename(s.file!), s.reason])).toEqual([['l.html', 'symlink'], ['u.html', 'unknown-page']]);
    expect((await provider.ingest({ path: 'l.html' })).skipped[0]!.reason).toBe('symlink');
  });

  it('inbox dışına çıkan yol reddedilir', async () => {
    await expect(provider.ingest({ path: path.join(fxDir, 'search.synthetic.html') })).rejects.toThrow(/inbox/);
    await expect(provider.ingest({ path: '../store.json' })).rejects.toThrow(/inbox/);
    await expect(provider.ingest({ path: '/usr' })).rejects.toThrow(/inbox/);
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(inbox, 'dirlink'));
    expect((await provider.ingest({ path: 'dirlink' })).skipped[0]!.reason).toBe('symlink');
  });

  it('inbox yoksa oluşturulur; olmayan dosya not-found', async () => {
    fs.rmSync(inbox, { recursive: true });
    expect(await provider.ingest({})).toEqual({ imported: [], skipped: [], storeSize: 0 });
    expect(fs.existsSync(inbox)).toBe(true);
    expect((await provider.ingest({ path: 'yok.html' })).skipped[0]!.reason).toBe('not-found');
  });

  it('html argümanı: file null, tekrarında duplicate', async () => {
    const html = fs.readFileSync(path.join(fxDir, 'search.synthetic.html'), 'utf8');
    const r = await provider.ingest({ html });
    expect(r.imported[0]).toMatchObject({ file: null, pageType: 'search', count: 3 });
    expect((await provider.ingest({ html })).skipped).toEqual([{ file: null, reason: 'duplicate' }]);
  });

  it('boyut sınırı', async () => {
    const big = 'a'.repeat(5_000_001);
    expect((await provider.ingest({ html: big })).skipped).toEqual([{ file: null, reason: 'too-large' }]);
  });
});

describe('ImportProvider.search / getListing', () => {
  const q = (o: object) => SearchQuerySchema.parse(o);

  it('store boşken hint ve searchUrls döner', async () => {
    const r = await provider.search(q({ city: 'Samsun' }));
    expect(r.results).toEqual([]);
    expect(r.hint).toContain(inbox);
    expect(r.searchUrls).toHaveLength(1);
  });

  it('import sonrası filtre ve detay arama', async () => {
    copy('search.synthetic.html');
    copy('listing.synthetic.html');
    await provider.ingest({});
    const all = await provider.search(q({}));
    expect(all.totalMatched).toBe(3);
    expect(all.hint).toBeUndefined();
    const r = await provider.search(q({ city: 'Samsun', priceMax: 800000 }));
    expect(r.results.every((x) => x.price! <= 800000)).toBe(true);
    expect(r.results.map((x) => x.price)).toEqual([...r.results.map((x) => x.price)].sort((a, b) => a! - b!));
    // detay verisi özetten öncelikli: 1000000001 artık source=listing
    expect(all.results.find((x) => x.id === '1000000001')!.source).toBe('listing');
    expect(all.results.every((x) => !('attributes' in x))).toBe(true);

    const byUrl = await provider.getListing('https://www.sahibinden.com/ilan/vasita-otomobil-volkswagen-golf-ornek-temiz-1000000001/detay');
    expect(byUrl.listing?.id).toBe('1000000001');
    expect(byUrl.summary?.id).toBe('1000000001');
    const onlySummary = await provider.getListing('1000000002');
    expect(onlySummary.listing).toBeNull();
    expect(onlySummary.summary?.id).toBe('1000000002');
    expect(await provider.getListing('9999999999')).toEqual({ listing: null, summary: null });
  });
});
