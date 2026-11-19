import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBrowserConfig } from '../src/browser/browser-config.js';
import { RateLimiter } from '../src/browser/rate-limiter.js';
import { BrowserProvider } from '../src/providers/browser-provider.js';
import { ImportProvider } from '../src/providers/import-provider.js';
import type { LiveProvider } from '../src/providers/live-provider.js';
import { createServer } from '../src/server.js';
import { JsonStore } from '../src/store/json-store.js';
import { browserStatusHandler, browserStatusInput, browserStatusOutput } from '../src/tools/browser-status.js';
import type { ToolDeps } from '../src/tools/deps.js';
import { liveGetListingsHandler, liveGetListingsInput, liveGetListingsOutput } from '../src/tools/live-get-listings.js';
import { liveSearchHandler, liveSearchInput, liveSearchOutput } from '../src/tools/live-search.js';
import { pingHandler, pingOutput } from '../src/tools/ping.js';
import { searchCarsHandler, searchCarsInput } from '../src/tools/search-cars.js';
import { FakePageSource } from './browser/fake-page-source.js';

const fxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (n: string) => fs.readFileSync(path.join(fxDir, n), 'utf8');
const T0 = Date.parse('2026-11-18T12:00:00.000Z');

/** Sunucuyu bellek içi JSON-RPC ile sürer (stdio olmadan). */
async function rpc(deps: ToolDeps) {
  const server = createServer(deps);
  const replies = new Map<number, any>();
  const transport: any = {
    start: async () => undefined,
    close: async () => undefined,
    send: async (m: any) => {
      if (m.id !== undefined) replies.get(m.id)?.(m);
    },
  };
  await server.connect(transport);
  let id = 0;
  const request = (method: string, params?: object) =>
    new Promise<any>((resolve) => {
      const i = ++id;
      replies.set(i, resolve);
      transport.onmessage({ jsonrpc: '2.0', id: i, method, params });
    });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  transport.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    tools: async () => ((await request('tools/list')).result.tools as { name: string; description?: string }[]),
    call: async (name: string, args: object) => (await request('tools/call', { name, arguments: args })).result,
  };
}

let dir: string;
let clock: { t: number };
let src: FakePageSource;
let provider: ImportProvider;
let store: JsonStore;

function makeLive(env: Record<string, string> = { SAHIBINDEN_BROWSER_MODE: 'on' }): BrowserProvider {
  const config = loadBrowserConfig(env, dir);
  return new BrowserProvider({
    config,
    importProvider: provider,
    store,
    source: src,
    limiter: new RateLimiter({
      statePath: config.statePath,
      minDelayMs: config.minDelayMs,
      hourlyCap: config.hourlyCap,
      challengeCooldownMs: config.challengeCooldownMs,
      now: () => clock.t,
      sleep: async (ms) => void (clock.t += ms),
    }),
    now: () => clock.t,
    runtimeSupported: () => true,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sah-live-'));
  clock = { t: T0 };
  src = new FakePageSource();
  store = new JsonStore(path.join(dir, 'store.json'));
  provider = new ImportProvider({ store, inboxDir: path.join(dir, 'inbox'), now: () => new Date(clock.t).toISOString() });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('tool kaydı (S6)', () => {
  const BASE = ['compare_cars', 'get_listing', 'import_listing_html', 'market_stats', 'ping', 'rank_cars', 'search_cars'];
  const LIVE = ['browser_status', 'live_get_listings', 'live_search'];

  it('live yokken tam 7 tool; canlı tool yok', async () => {
    const s = await rpc({ provider, nowYear: () => 2026 });
    expect((await s.tools()).map((t) => t.name).sort()).toEqual(BASE);
  });

  it('live varken 10 tool; açıklamalar Claude yönlendirmesini içerir', async () => {
    const s = await rpc({ provider, nowYear: () => 2026, live: makeLive() });
    const tools = await s.tools();
    expect(tools.map((t) => t.name).sort()).toEqual([...BASE, ...LIVE].sort());
    const d = (n: string) => tools.find((t) => t.name === n)!.description!;
    expect(d('live_search')).toContain('YALNIZCA kullanıcı');
    expect(d('live_search')).toContain('KENDİSİNİN');
    expect(d('live_search')).toContain('otomatik tekrar deneme');
    expect(d('live_get_listings')).toContain('YALNIZCA kullanıcı');
    expect(d('browser_status')).toContain('gitmez');
  });

  it('ping browserMode', async () => {
    expect(pingOutput.parse(await pingHandler({}, { provider })).browserMode).toBe('disabled');
    expect(pingOutput.parse(await pingHandler({}, { provider, live: makeLive() })).browserMode).toBe('enabled');
  });
});

describe('şemalar', () => {
  it('live_search girdisi: varsayılan 3, üst sınır 10, search_cars filtreleri aynı', () => {
    expect(liveSearchInput.parse({ models: ['Golf'] }).maxPages).toBe(3);
    expect(() => liveSearchInput.parse({ maxPages: 11 })).toThrow();
    expect(() => liveSearchInput.parse({ maxPages: 0 })).toThrow();
    expect(liveSearchInput.parse({ city: 'Samsun', priceMax: 900000, fuel: 'diesel' })).toMatchObject({
      city: 'Samsun', priceMax: 900000, fuel: 'diesel', sort: 'price_asc', limit: 20,
    });
  });
  it('live_get_listings girdisi: varsayılan 3 / skipKnown, en çok 10 ref', () => {
    const v = liveGetListingsInput.parse({ refs: ['1000000001'] });
    expect(v).toMatchObject({ maxListings: 3, skipKnown: true });
    expect(() => liveGetListingsInput.parse({ refs: [] })).toThrow();
    expect(() => liveGetListingsInput.parse({ refs: Array(11).fill('1000000001') })).toThrow();
  });
});

describe('sahte LiveProvider ile handler\'lar', () => {
  const run = { status: 'ok' as const, message: 'x', visits: [], notVisited: [], freshIds: [], nextAllowedAt: null };
  it('girdileri provider\'a iletir ve çıktı şemaya uyar', async () => {
    const calls: unknown[] = [];
    const live: LiveProvider = {
      status: async () => ({
        status: 'not-running', message: 'm', enabled: true, runtimeSupported: true, nodeVersion: 'v22', profileDir: '/p',
        chrome: { reachable: false, version: null },
        rateLimit: { minDelayMs: 5000, maxPagesPerCall: 3, pagesLastHour: 0, hourlyCap: 30, nextAllowedAt: null },
        pendingChallenge: null,
      }),
      liveSearch: async (q, o) => {
        calls.push(['search', q, o]);
        return { outcome: await provider.search(q), live: run };
      },
      liveGetListings: async (refs, o) => {
        calls.push(['get', refs, o]);
        return { live: run, items: [{ ref: refs[0]!, id: null, state: 'invalid-ref' }], storeSize: 0 };
      },
    };
    const deps = { provider, nowYear: () => 2026, live };
    expect(browserStatusOutput.parse(await browserStatusHandler(browserStatusInput.parse({}), deps)).status).toBe('not-running');
    const s = liveSearchOutput.parse(await liveSearchHandler(liveSearchInput.parse({ models: ['Golf'], maxPages: 2 }), deps));
    expect(s.live.status).toBe('ok');
    expect(calls[0]).toMatchObject(['search', { models: ['Golf'] }, { maxPages: 2 }]);
    expect((calls[0] as any)[1].maxPages).toBeUndefined();
    const g = liveGetListingsOutput.parse(await liveGetListingsHandler(liveGetListingsInput.parse({ refs: ['abc'] }), deps));
    expect(g.items[0]!.state).toBe('invalid-ref');
    expect(calls[1]).toMatchObject(['get', ['abc'], { maxListings: 3, skipKnown: true }]);
  });
  it('live yoksa handler hata verir', async () => {
    await expect(liveSearchHandler(liveSearchInput.parse({}), { live: undefined })).rejects.toThrow();
  });
});

describe('sunucu üzerinden canlı akış (sahte sayfa kaynağı, ağ yok)', () => {
  it('live_search: sayfa import hattından geçer; sonuç search_cars ile aynı filtre/appliedFilters', async () => {
    const live = makeLive();
    const s = await rpc({ provider, nowYear: () => 2026, live });
    src.steps = [{ html: fx('search.synthetic.html') }];
    const r = await s.call('live_search', { models: ['Golf'], maxPages: 1, priceMax: 2000000 });
    expect(r.isError).toBeUndefined();
    const out = liveSearchOutput.parse(r.structuredContent);
    expect(out.live.status).toBe('ok');
    expect(out.live.visits[0]).toMatchObject({ pageType: 'search', imported: 3 });
    expect(out.live.freshIds).toHaveLength(3);
    expect(out.storeSize).toBe(3);

    const plain = await searchCarsHandler(searchCarsInput.parse({ models: ['Golf'], priceMax: 2000000 }), { provider });
    expect(out.results).toEqual(plain.results.map((x) => ({ ...x })));
    expect(out.appliedFilters).toEqual(plain.appliedFilters);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.appliedFilters).toEqual(expect.arrayContaining(['priceMax']));
    expect(out.totalMatched).toBe(plain.totalMatched);
    expect(JSON.stringify(r)).not.toContain('<html');
  });

  it('live_get_listings: ilan detayı içe aktarılır, sonra get_listing bulur', async () => {
    const live = makeLive();
    const s = await rpc({ provider, nowYear: () => 2026, live });
    src.steps = [{ html: fx('listing.synthetic.html') }];
    const r = await s.call('live_get_listings', { refs: ['1000000001', 'geçersiz-ref'] });
    const out = liveGetListingsOutput.parse(r.structuredContent);
    expect(out.live.status).toBe('ok');
    expect(out.items.map((i) => i.state)).toEqual(['imported', 'invalid-ref']);
    expect(out.storeSize).toBe(1);
    const g = await s.call('get_listing', { ref: '1000000001' });
    expect(g.structuredContent.listing.id).toBe('1000000001');
  });

  it('doğrulama sayfası: challenge-detected, kullanıcıya yönlendirme; ikinci çağrı challenge-pending ve gezinme yok', async () => {
    const live = makeLive();
    const s = await rpc({ provider, nowYear: () => 2026, live });
    src.steps = [{ html: fx('challenge.tr.html'), nav: { quickKind: 'challenge' } }];
    const a = liveSearchOutput.parse((await s.call('live_search', { models: ['Golf'] })).structuredContent);
    expect(a.live.status).toBe('challenge-detected');
    expect(a.live.userAction).toContain('kendiniz');
    src.attachBehavior = 'challenge';
    const nav = src.navigateCalls.length;
    const b = liveSearchOutput.parse((await s.call('live_search', { models: ['Golf'] })).structuredContent);
    expect(b.live.status).toBe('challenge-pending');
    expect(src.navigateCalls.length).toBe(nav);
    const st = browserStatusOutput.parse((await s.call('browser_status', {})).structuredContent);
    expect(st.status).toBe('challenge-pending');
    expect(st.pendingChallenge).not.toBeNull();
  });

  it('browser_status gezinmez; Chrome yoksa not-running', async () => {
    const live = makeLive();
    const s = await rpc({ provider, nowYear: () => 2026, live });
    src.connectError = new (await import('../src/browser/errors.js')).BrowserError('not-running', 'yok');
    const st = browserStatusOutput.parse((await s.call('browser_status', {})).structuredContent);
    expect(st).toMatchObject({ status: 'not-running', enabled: true, chrome: { reachable: false } });
    expect(src.navigateCalls).toEqual([]);
  });

  it('maxPages 11 → girdi doğrulaması reddeder', async () => {
    const s = await rpc({ provider, nowYear: () => 2026, live: makeLive() });
    const r = await s.call('live_search', { maxPages: 11 });
    expect(r.isError).toBe(true);
    expect(src.navigateCalls).toEqual([]);
  });
});
