import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../src/store/json-store.js';
import { parseListingPage, parseSearchPage } from '../src/sahibinden/parser.js';

const fx = (n: string) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n), 'utf8');
const t1 = { capturedAt: '2026-11-18T10:00:00.000Z' };
const t2 = { capturedAt: '2026-11-19T10:00:00.000Z' };

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-store-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('JsonStore', () => {
  it('dosya yoksa boş; save dizini oluşturur ve tmp bırakmaz', () => {
    const file = path.join(dir, 'a', 'b', 'store.json');
    const s = new JsonStore(file);
    expect(s.size()).toBe(0);
    s.upsertSummary(parseSearchPage(fx('search.synthetic.html'), t1).items[0]!);
    s.save();
    expect(fs.readdirSync(path.dirname(file))).toEqual(['store.json']);
    expect(new JsonStore(file).size()).toBe(1);
  });

  it('ilan no ile tekilleştirir; detay özetle birlikte tutulur', () => {
    const s = new JsonStore(path.join(dir, 'store.json'));
    for (const it of parseSearchPage(fx('search.synthetic.html'), t1).items) s.upsertSummary(it);
    s.upsertListing(parseListingPage(fx('listing.synthetic.html'), t1));
    expect(s.size()).toBe(3);
    const e = s.get('1000000001')!;
    expect(e.listing?.source).toBe('listing');
    expect(e.summary?.source).toBe('search');
  });

  it('fiyat değişince priceHistory; aynı fiyat tekrar eklenmez', () => {
    const s = new JsonStore(path.join(dir, 'store.json'));
    const item = parseSearchPage(fx('search.synthetic.html'), t1).items[0]!;
    s.upsertSummary(item);
    s.upsertSummary({ ...item, capturedAt: t2.capturedAt });
    expect(s.get(item.id)!.priceHistory).toHaveLength(1);
    s.upsertSummary({ ...item, price: 850000, capturedAt: t2.capturedAt });
    expect(s.get(item.id)!.priceHistory).toEqual([
      { price: 875000, currency: 'TL', capturedAt: t1.capturedAt },
      { price: 850000, currency: 'TL', capturedAt: t2.capturedAt },
    ]);
  });

  it('dosya hash kaydı kalıcı', () => {
    const file = path.join(dir, 'store.json');
    const s = new JsonStore(file);
    s.markFile('abc', 'x.html', t1.capturedAt);
    s.save();
    expect(new JsonStore(file).hasFile('abc')).toBe(true);
    expect(new JsonStore(file).hasFile('zzz')).toBe(false);
  });

  it('bozuk dosyada veriyi ezmeden hata verir', () => {
    const file = path.join(dir, 'store.json');
    fs.writeFileSync(file, '{bozuk');
    expect(() => new JsonStore(file).size()).toThrow(/bozuk/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{bozuk');
  });
});
