import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBrowserConfig } from '../src/browser/browser-config.js';
import type { BrowserConfig } from '../src/browser/browser-config.js';
import { BrowserError } from '../src/browser/errors.js';
import { acquireLock } from '../src/browser/lock.js';
import { RateLimiter } from '../src/browser/rate-limiter.js';
import { BrowserProvider } from '../src/providers/browser-provider.js';
import { ImportProvider } from '../src/providers/import-provider.js';
import { SearchQuerySchema } from '../src/sahibinden/types.js';
import { JsonStore } from '../src/store/json-store.js';
import { FakePageSource } from './browser/fake-page-source.js';

const fxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (n: string) => fs.readFileSync(path.join(fxDir, n), 'utf8');
const SEARCH_A = fx('search.synthetic.html');
const SEARCH_B = fx('real-shape.search.html');
const CHALLENGE_TR = fx('challenge.tr.html');
const LISTING = fx('listing.synthetic.html');
const T0 = Date.parse('2026-11-18T12:00:00.000Z');

/** 20 satırlık (PAGE_SIZE) sentetik arama sayfası; her sayfa farklı ilan no'ları içerir. */
function fullPage(tag: number): string {
  const rows = Array.from({ length: 20 }, (_, k) => {
    const id = 3_000_000_000 + tag * 100 + k;
    return `<tr class="searchResultsItem" data-id="${id}">
      <td class="searchResultsLargeThumbnail"></td>
      <td class="searchResultsTagAttributeValue">Golf</td>
      <td class="searchResultsTagAttributeValue">1.6 TDi</td>
      <td class="searchResultsTitleValue"><a class="classifiedTitle" href="/ilan/vasita-otomobil-volkswagen-golf-x-${id}/detay">Golf ${id}</a></td>
      <td class="searchResultsAttributeValue">2016</td><td class="searchResultsAttributeValue">100.000</td>
      <td class="searchResultsAttributeValue">Beyaz</td><td class="searchResultsPriceValue"><div>800.000 TL</div></td>
      <td class="searchResultsDateValue"><span>18 Kasım</span><br><span>2026</span></td>
      <td class="searchResultsLocationValue">Samsun<br>Atakum</td></tr>`;
  }).join('\n');
  return SEARCH_A.replace(/<tbody>[\s\S]*<\/tbody>/, `<tbody>${rows}</tbody>`);
}
const listingFor = (id: string) => LISTING.replaceAll('1000000001', id);
const q = (o: object = {}) => SearchQuerySchema.parse(o);

let dir: string;
let clock: { t: number; sleeps: number[] };
let src: FakePageSource;
let store: JsonStore;
let imp: ImportProvider;
let limiter: RateLimiter;
let config: BrowserConfig;

function build(env: Record<string, string> = { SAHIBINDEN_BROWSER_MODE: 'on' }, overrides: Partial<BrowserConfig> = {}) {
  config = { ...loadBrowserConfig(env, dir), ...overrides };
  limiter = new RateLimiter({
    statePath: config.statePath,
    minDelayMs: config.minDelayMs,
    hourlyCap: config.hourlyCap,
    challengeCooldownMs: config.challengeCooldownMs,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.t += ms;
    },
  });
  return new BrowserProvider({
    config,
    importProvider: imp,
    store,
    source: src,
    limiter,
    now: () => clock.t,
    runtimeSupported: () => true,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-bp-'));
  clock = { t: T0, sleeps: [] };
  src = new FakePageSource();
  store = new JsonStore(path.join(dir, 'store.json'));
  imp = new ImportProvider({ store, inboxDir: path.join(dir, 'inbox'), now: () => new Date(clock.t).toISOString() });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('BrowserProvider', () => {
  it('1. kapalıyken disabled; gezinme ve bağlantı yok', async () => {
    const p = build({});
    const { live } = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 3 });
    expect(live.status).toBe('disabled');
    expect(live.visits).toEqual([]);
    expect(live.userAction).toContain('SAHIBINDEN_BROWSER_MODE=on');
    expect(src.navigateCalls).toEqual([]);
    expect(src.connectCalls).toBe(0);
    expect((await p.status()).status).toBe('disabled');
  });

  it('desteklenmeyen çalışma zamanı → unsupported-runtime', async () => {
    build();
    const p = new BrowserProvider({
      config, importProvider: imp, store, source: src, limiter, now: () => clock.t, runtimeSupported: () => false,
    });
    expect((await p.liveSearch(q({ models: ['Golf'] }), {})).live.status).toBe('unsupported-runtime');
    expect(src.connectCalls).toBe(0);
  });

  it('2. iki arama sayfası: ok, store dolar, ≥5 sn sabit bekleme, freshIds', async () => {
    const p = build();
    src.steps = [{ html: SEARCH_A }, { html: SEARCH_B }];
    const { outcome, live } = await p.liveSearch(q({ models: ['Golf', 'Astra'] }), { maxPages: 2 });
    expect(live.status).toBe('ok');
    expect(live.visits).toHaveLength(2);
    expect(live.visits.map((v) => v.pageType)).toEqual(['search', 'search']);
    expect(live.visits.map((v) => v.imported)).toEqual([3, 3]);
    expect(live.freshIds).toEqual(['1000000001', '1000000002', '1000000003', '1000000101', '1000000102', '1000000103']);
    expect(store.size()).toBe(6);
    expect(outcome.results.map((r) => r.series)).toEqual(expect.arrayContaining(['Golf', 'Astra']));
    expect(clock.sleeps.length).toBeGreaterThanOrEqual(1);
    expect(clock.sleeps.every((ms) => ms >= 5000)).toBe(true);
    expect(src.closedTabs).toEqual(src.openedTabs); // challenge yok: sekme kapatıldı
    expect(src.sessionsClosed).toBe(1);
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });

  it('tek model, sayfa dolu değil → sonraki sayfa açılmaz (bütçeden düşülmez)', async () => {
    const p = build();
    src.steps = [{ html: SEARCH_A }, { html: SEARCH_B }];
    const { live } = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 3 });
    expect(live.status).toBe('ok');
    expect(src.navigateCalls).toHaveLength(1);
    expect(live.notVisited).toEqual([]);
  });

  it('3. arama → challenge → durur, sekme açık kalır, notVisited, ilk sayfa store\'da', async () => {
    const p = build();
    src.steps = [{ html: SEARCH_A }, { html: CHALLENGE_TR, nav: { quickKind: 'challenge' } }];
    const { live } = await p.liveSearch(q({ models: ['Golf', 'Astra', 'Focus'] }), { maxPages: 3 });
    expect(live.status).toBe('challenge-detected');
    expect(live.userAction).toContain('kendiniz');
    expect(src.navigateCalls).toHaveLength(2);
    expect(live.notVisited).toHaveLength(1);
    expect(live.notVisited[0]).toContain('/ford-focus');
    expect(live.visits[1]!.pageType).toBe('challenge');
    expect(src.closedTabs).toEqual([]); // challenge sekmesi kapatılmadı
    expect(store.size()).toBe(3);
    expect(limiter.pendingChallenge()).toMatchObject({ targetId: src.openedTabs[0] });
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });

  it('challenge yalnızca HTML ile (Türkçe sayfa, quickKind ready) ve 403+cf-mitigated ile de tespit edilir', async () => {
    let p = build();
    src.steps = [{ html: CHALLENGE_TR }];
    expect((await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 })).live.status).toBe('challenge-detected');

    fs.rmSync(config.statePath);
    src = new FakePageSource();
    p = build();
    src.steps = [{ html: '<html><body>Forbidden</body></html>', nav: { httpStatus: 403, cfMitigated: true } }];
    expect((await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 })).live.status).toBe('challenge-detected');
  });

  it('4. challenge sonrası ikinci çağrı: challenge-pending, sıfır yeni gezinme', async () => {
    const p = build();
    src.steps = [{ html: CHALLENGE_TR, nav: { quickKind: 'challenge' } }];
    await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 2 });
    expect(src.navigateCalls).toHaveLength(1);

    src.attachBehavior = 'challenge';
    src.steps = [{ html: SEARCH_A }];
    const again = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 2 });
    expect(again.live.status).toBe('challenge-pending');
    expect(again.live.visits).toEqual([]);
    expect(src.navigateCalls).toHaveLength(1); // artmadı
    expect(src.closedTabs).toEqual([]);
    expect(src.openedTabs).toHaveLength(1);
    expect((await p.status()).status).toBe('challenge-pending');
  });

  it('5. doğrulama geçildi: kilit temizlenir, 60 sn soğuma dolmadan gezinilmez', async () => {
    const p = build();
    src.steps = [{ html: CHALLENGE_TR, nav: { quickKind: 'challenge' } }];
    await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 });
    const challengeTab = src.openedTabs[0]!;

    clock.t += 20_000; // kullanıcı doğrulamayı geçti
    src.attachBehavior = 'ready';
    src.steps = [{ html: SEARCH_A }];
    clock.sleeps.length = 0;
    const r = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 });
    expect(r.live.status).toBe('ok');
    expect(limiter.pendingChallenge()).toBeNull();
    expect(src.closedTabs).toContain(challengeTab);
    expect(clock.sleeps).toEqual([60_000]); // geçiş anından itibaren 60 sn
  });

  it('6. maxPages 50 doğrudan provider çağrısı → en fazla 10 gezinme', async () => {
    const p = build();
    src.stepFn = (_u, n) => ({ html: fullPage(n) });
    const { live } = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 50 });
    expect(src.navigateCalls).toHaveLength(10);
    expect(new Set(src.navigateCalls).size).toBe(10);
    expect(live.visits).toHaveLength(10);
    expect(live.status).toBe('ok');
    expect(clock.sleeps.every((ms) => ms >= 5000)).toBe(true);
  });

  it('7. 4 model, maxPages 3 → ilk 3 modelin 1. sayfası, 4. model notVisited', async () => {
    const p = build();
    src.stepFn = (_u, n) => ({ html: fullPage(n) });
    const { live } = await p.liveSearch(q({ models: ['Golf', 'Astra', 'Focus', 'Corolla'] }), { maxPages: 3 });
    expect(src.navigateCalls).toHaveLength(3);
    expect(src.navigateCalls[0]).toContain('/volkswagen-golf');
    expect(src.navigateCalls[1]).toContain('/opel-astra');
    expect(src.navigateCalls[2]).toContain('/ford-focus');
    expect(live.notVisited).toHaveLength(1);
    expect(live.notVisited[0]).toContain('/toyota-corolla');
  });

  it('round-robin: bütçe kalırsa model başına 2. sayfa; sayfa numarası offset olur', async () => {
    const p = build();
    src.stepFn = (_u, n) => ({ html: fullPage(n) });
    await p.liveSearch(q({ models: ['Golf', 'Astra'] }), { maxPages: 4 });
    expect(src.navigateCalls.map((u) => [u.includes('golf'), u.includes('pagingOffset=20')])).toEqual([
      [true, false], [false, false], [true, true], [false, true],
    ]);
  });

  it('8. giriş yönlendirmesi, bilinmeyen sayfa, yabancı host', async () => {
    let p = build();
    src.steps = [{ html: '<html><body>giriş</body></html>', nav: { finalUrl: 'https://secure.sahibinden.com/giris' } }];
    expect((await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 })).live.status).toBe('login-required');

    src = new FakePageSource();
    p = build();
    src.steps = [{ html: '<html><body><p>merhaba</p></body></html>' }];
    expect((await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 })).live.status).toBe('unexpected-page');

    src = new FakePageSource();
    p = build();
    src.steps = [{ html: SEARCH_A, nav: { finalUrl: 'https://evil.test/' } }];
    const r = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 });
    expect(r.live.status).toBe('unexpected-page');
    expect(store.size()).toBe(0); // yabancı hosttan içe aktarma yok
  });

  it('timeout, navigation-error ve deadline durumları; hiçbiri otomatik tekrar denemez', async () => {
    let p = build();
    src.steps = [{ html: '', nav: { quickKind: 'timeout' } }];
    expect((await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 3 })).live.status).toBe('timeout');
    expect(src.navigateCalls).toHaveLength(1);

    src = new FakePageSource();
    fs.rmSync(config.statePath, { force: true });
    p = build();
    src.steps = [{ html: '', nav: { errorText: 'net::ERR_INTERNET_DISCONNECTED' } }];
    const ne = (await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 3 })).live;
    expect(ne.status).toBe('navigation-error');
    expect(ne.message).toContain('ERR_INTERNET_DISCONNECTED');
    expect(src.navigateCalls).toHaveLength(1);

    src = new FakePageSource();
    fs.rmSync(config.statePath, { force: true });
    p = build(undefined, { callDeadlineMs: 6000 });
    src.stepFn = (_u, n) => ({ html: fullPage(n) });
    const dl = (await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 6 })).live;
    expect(dl.status).toBe('deadline');
    expect(src.navigateCalls).toHaveLength(3); // 4. gezinmeden önce süre (6 sn) aşıldı
    expect(dl.visits).toHaveLength(3);
    expect(dl.notVisited.length).toBeGreaterThan(0);
  });

  it('saatlik sınır: hourly-cap + nextAllowedAt', async () => {
    const p = build({ SAHIBINDEN_BROWSER_MODE: 'on', SAHIBINDEN_BROWSER_HOURLY_CAP: '2' });
    src.stepFn = (_u, n) => ({ html: fullPage(n) });
    const { live } = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 5 });
    expect(live.status).toBe('hourly-cap');
    expect(live.visits).toHaveLength(2);
    expect(live.nextAllowedAt).toBe(new Date(T0 + 3_600_000).toISOString());
    expect(src.navigateCalls).toHaveLength(2);
  });

  it('Chrome yok → not-running, ziyaret yok, kilit bırakıldı', async () => {
    const p = build();
    src.connectError = new BrowserError('not-running', 'Adanmış Chrome çalışmıyor', "npm run chrome ile adanmış Chrome'u başlatın");
    const { live } = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 });
    expect(live.status).toBe('not-running');
    expect(live.visits).toEqual([]);
    expect(live.userAction).toContain('npm run chrome');
    expect(fs.existsSync(config.lockPath)).toBe(false);
    const st = await p.status();
    expect(st).toMatchObject({ status: 'not-running', chrome: { reachable: false, version: null } });
  });

  it('9. kilit başka süreçte tutuluyor → busy, gezinme ve bağlantı yok', async () => {
    const p = build();
    const release = acquireLock(config.lockPath, { now: () => clock.t, pid: 99999 })!;
    const { live } = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 2 });
    expect(live.status).toBe('busy');
    expect(src.navigateCalls).toEqual([]);
    expect(src.connectCalls).toBe(0);
    release();
  });

  it('status(): Chrome erişilebilirken sürüm ve hız sınırı bilgisi, gezinme yok', async () => {
    const p = build();
    const st = await p.status();
    expect(st).toMatchObject({
      status: 'ok',
      enabled: true,
      runtimeSupported: true,
      chrome: { reachable: true, version: 'Chrome/999.0.0.0' },
      rateLimit: { minDelayMs: 5000, maxPagesPerCall: 3, pagesLastHour: 0, hourlyCap: 30, nextAllowedAt: null },
      pendingChallenge: null,
    });
    expect(src.navigateCalls).toEqual([]);
    expect(src.openedTabs).toEqual([]);
  });

  it('10. çıktı JSON\'unda ham HTML/satıcı adı/telefon yok; denetim kaydında HTML yok', async () => {
    const p = build();
    src.steps = [{ html: SEARCH_A }];
    const s = await p.liveSearch(q({ models: ['Golf'] }), { maxPages: 1 });
    src.steps = [{ html: listingFor('1000000001') }];
    const g = await p.liveGetListings(['1000000001'], { maxListings: 1, skipKnown: false });
    for (const out of [JSON.stringify(s), JSON.stringify(g)]) {
      expect(out).not.toContain('<html');
      expect(out).not.toContain('<td');
      expect(out).not.toContain('Örnek Otomotiv');
      expect(out).not.toContain('pretty-phone');
    }
    expect(g.items[0]).toMatchObject({ state: 'imported', id: '1000000001' });
    const lines = fs.readFileSync(config.auditLogPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain('<');
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(['at', 'httpStatus', 'imported', 'pageType', 'status', 'tool', 'url']);
    }
    const stateFiles = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('<html'));
    expect(stateFiles.some(Boolean)).toBe(false);
  });

  it('11. liveGetListings: 5 ref, maxListings 3 → 3 imported, 2 not-visited; geçersiz ref; yakın tarihli skipped-known', async () => {
    const p = build();
    const ids = ['1000000011', '1000000012', '1000000013', '1000000014', '1000000015'];
    src.stepFn = (url) => ({ html: listingFor(/(\d{10})\/detay/.exec(url)![1]!) });
    const r = await p.liveGetListings([...ids, 'abc'], { maxListings: 3, skipKnown: true });
    expect(r.live.status).toBe('ok');
    expect(r.items.map((i) => i.state)).toEqual([
      'imported', 'imported', 'imported', 'not-visited', 'not-visited', 'invalid-ref',
    ]);
    expect(r.items[3]!.reason).toBe('budget');
    expect(r.live.freshIds).toEqual(ids.slice(0, 3));
    expect(r.storeSize).toBe(3);
    expect(src.navigateCalls).toHaveLength(3);
    expect(src.navigateCalls[0]).toBe('https://www.sahibinden.com/ilan/1000000011/detay');

    // Aynı ilanlar 24 saat içinde: yeniden açılmaz.
    const before = src.navigateCalls.length;
    const again = await p.liveGetListings(ids.slice(0, 3), { maxListings: 3, skipKnown: true });
    expect(again.items.map((i) => i.state)).toEqual(['skipped-known', 'skipped-known', 'skipped-known']);
    expect(again.live.visits).toEqual([]);
    expect(src.navigateCalls).toHaveLength(before);

    // skipKnown=false: yeniden açılır; içerik aynı olduğundan skipped-known(duplicate) döner.
    src.stepFn = (url) => ({ html: listingFor(/(\d{10})\/detay/.exec(url)![1]!) });
    const forced = await p.liveGetListings(ids.slice(0, 1), { maxListings: 3, skipKnown: false });
    expect(src.navigateCalls).toHaveLength(before + 1);
    expect(forced.items[0]).toMatchObject({ state: 'skipped-known', reason: 'duplicate' });
  });

  it('liveGetListings: challenge → kalan ilanlar not-visited (neden: challenge-detected), ek gezinme yok', async () => {
    const p = build();
    src.steps = [{ html: CHALLENGE_TR, nav: { quickKind: 'challenge' } }];
    const r = await p.liveGetListings(['1000000021', '1000000022'], { maxListings: 2, skipKnown: true });
    expect(r.live.status).toBe('challenge-detected');
    expect(src.navigateCalls).toHaveLength(1);
    expect(r.items[0]!.state).toBe('failed');
    expect(r.items[1]).toMatchObject({ state: 'not-visited', reason: 'challenge-detected' });
    expect(r.live.notVisited).toHaveLength(1);
  });

  it('liveGetListings: URL referansı yalnızca sahibinden ilan URL\'si ise gezilir', async () => {
    const p = build();
    src.stepFn = () => ({ html: listingFor('1000000031') });
    const r = await p.liveGetListings(
      ['https://evil.test/ilan/x-1000000031/detay', 'https://www.sahibinden.com/ilan/vasita-x-1000000031/detay?foo=1'],
      { maxListings: 3, skipKnown: true },
    );
    expect(r.items.map((i) => i.state)).toEqual(['invalid-ref', 'imported']);
    expect(src.navigateCalls).toEqual(['https://www.sahibinden.com/ilan/vasita-x-1000000031/detay']);
  });
});
