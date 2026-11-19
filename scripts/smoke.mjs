// Bağımlılıksız smoke testi (gerçek Chrome/ağ YOK):
//   Koşu A: tarayıcı modu kapalı (varsayılan) -> stdio, tam 7 tool.
//   Koşu B: SAHIBINDEN_BROWSER_MODE=on + boş profil -> stdio, 10 tool, Chrome yok -> 'not-running'.
//   Koşu C: dist/ modülleri süreç içinde, sahte sayfa kaynağıyla live_search / live_get_listings akışı.
//   Koşu D: price_drops handler + get_listing.tracking (dist, süreç içi, geçici store).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sahibinden-smoke-'));
const live = [];
let timer;

function finish(code, text) {
  clearTimeout(timer);
  console.log(text);
  for (const c of live) c.kill();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(code);
}
const fail = (m) => finish(1, `SMOKE FAIL: ${m}`);
const assert = (cond, msg) => { if (!cond) fail(msg); };
timer = setTimeout(() => fail('timeout (45s)'), 45000);

/** dist/index.js'i stdio ile başlatır; JSON-RPC istemcisi döner. */
function startStdio(label, extraEnv) {
  const home = fs.mkdtempSync(path.join(tmpRoot, `${label}-`));
  const inbox = path.join(home, 'inbox');
  fs.mkdirSync(inbox);
  for (const f of ['search.synthetic.html', 'listing.synthetic.html']) {
    fs.copyFileSync(path.join(root, 'tests/fixtures', f), path.join(inbox, f));
  }
  const env = { ...process.env, SAHIBINDEN_MCP_HOME: home, ...extraEnv };
  if (!extraEnv.SAHIBINDEN_BROWSER_MODE) delete env.SAHIBINDEN_BROWSER_MODE;
  const child = spawn('node', [path.join(root, 'dist/index.js')], { stdio: ['pipe', 'pipe', 'pipe'], env });
  live.push(child);
  const pending = new Map();
  let buf = '';
  let nextId = 1;
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return fail(`stdout'ta JSON olmayan satır: ${line.slice(0, 80)}`);
      }
      if (msg.id !== undefined) pending.get(msg.id)?.(msg);
    }
  });
  child.on('error', (e) => fail(e.message));
  child.stderr.on('data', () => {});
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      send({ jsonrpc: '2.0', id, method, params });
    });
  return { home, inbox, send, request, call: (name, args) => request('tools/call', { name, arguments: args }), child };
}

async function initialize(c) {
  const init = await c.request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' },
  });
  assert(init.result, 'initialize yanıtı yok');
  c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

const BASE = ['compare_cars', 'get_listing', 'import_listing_html', 'market_stats', 'ping', 'rank_cars', 'search_cars'];
const LIVE = ['browser_status', 'live_get_listings', 'live_search'];

try {
  // ---- Koşu A: tarayıcı modu kapalı (varsayılan) ----
  const A = startStdio('A', {});
  await initialize(A);
  const list = await A.request('tools/list');
  const tools = list.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  const expected = BASE;
  assert(JSON.stringify(names) === JSON.stringify(expected), `tool listesi beklenenden farklı: ${names}`);
  for (const t of tools) assert(t.inputSchema && t.outputSchema, `${t.name}: input/output şeması eksik`);

  const ping = await A.call('ping', { msg: 'hi' });
  assert(ping.result?.structuredContent?.pong === 'hi', 'pong != hi');
  assert(ping.result.structuredContent.browserMode === 'disabled', 'ping.browserMode != disabled (koşu A)');
  assert(ping.result.structuredContent.inboxDir === A.inbox, 'ping inboxDir geçici dizin değil');

  const imp = await A.call('import_listing_html', { path: path.join(A.inbox, 'search.synthetic.html') });
  assert(imp.result?.structuredContent?.imported?.[0]?.count === 3, 'import count != 3');
  const impListing = await A.call('import_listing_html', { path: 'listing.synthetic.html' });
  assert(impListing.result?.structuredContent?.imported?.[0]?.pageType === 'listing', 'listing import başarısız');

  const outside = await A.call('import_listing_html', { path: path.join(root, 'tests/fixtures/search.synthetic.html') });
  assert(outside.result?.isError === true || outside.error, 'inbox dışı path reddedilmedi');

  const search = await A.call('search_cars', {});
  assert(search.result?.structuredContent?.results?.length === 3, 'search_cars results != 3');
  assert(search.result.structuredContent.searchUrls.length >= 1, 'searchUrls boş');

  // Birleşik filtre: yalnızca detayı içe aktarılmış beyaz/5 kapı/105 hp Golf kalır (diğer ikisi rengi uyuşmadığı için elenir).
  const combo = await A.call('search_cars', {
    city: 'Samsun', priceMax: 900000, bodyType: 'hatchback-5-door', fuel: 'diesel', enginePower: '101-125',
    color: 'white', unknown: 'exclude',
  });
  const co = combo.result?.structuredContent;
  assert(co?.results?.length === 1 && co.results[0].id === '1000000001', 'birleşik filtre sonucu beklenenden farklı');
  assert(co.excludedUnknown === 0 && co.urlOnlyFilters.length === 0 && co.appliedFilters.includes('enginePower'), 'birleşik filtre sayaçları yanlış');
  assert(co.searchUrls[0].url.includes('a2320=74345') && co.searchUrls[0].url.includes('a3=33611'), 'birleşik filtre URL\'ye yansımadı');

  const cmp = await A.call('compare_cars', { refs: ['1000000001', '1000000002', '9999999999'] });
  const cmpOut = cmp.result?.structuredContent;
  assert(cmpOut?.rows?.length === 2 && cmpOut.missing?.[0] === '9999999999', 'compare_cars sonucu beklenenden farklı');

  const get = await A.call('get_listing', { ref: '1000000001' });
  assert(get.result?.structuredContent?.listing?.id === '1000000001', 'get_listing bulamadı');

  const bad = await A.call('compare_cars', { refs: ['x'] });
  assert(bad.result?.isError === true || bad.error, 'compare_cars tek ref hata vermedi');

  A.child.kill();

  // ---- Koşu B: tarayıcı modu açık, Chrome yok (boş profil) ----
  const emptyProfile = path.join(tmpRoot, 'empty-profile');
  fs.mkdirSync(emptyProfile);
  const B = startStdio('B', { SAHIBINDEN_BROWSER_MODE: 'on', SAHIBINDEN_BROWSER_PROFILE_DIR: emptyProfile });
  await initialize(B);
  const bTools = (await B.request('tools/list')).result?.tools ?? [];
  const bNames = bTools.map((t) => t.name).sort();
  assert(JSON.stringify(bNames) === JSON.stringify([...BASE, ...LIVE].sort()), `koşu B tool listesi beklenenden farklı: ${bNames}`);
  for (const t of bTools) assert(t.inputSchema && t.outputSchema, `${t.name}: input/output şeması eksik (B)`);
  const bPing = await B.call('ping', {});
  assert(bPing.result?.structuredContent?.browserMode === 'enabled', 'ping.browserMode != enabled (koşu B)');
  const unsupported = typeof globalThis.WebSocket !== 'function';
  const bStatus = (await B.call('browser_status', {})).result?.structuredContent;
  assert(bStatus?.chrome?.reachable === false, 'browser_status.chrome.reachable != false');
  assert(bStatus.status === 'not-running' || (unsupported && bStatus.status === 'unsupported-runtime'), `browser_status.status beklenmeyen: ${bStatus?.status}`);
  const bSearch = (await B.call('live_search', { models: ['Golf'], maxPages: 1 })).result?.structuredContent;
  assert(
    bSearch?.live?.status === 'not-running' || (unsupported && bSearch?.live?.status === 'unsupported-runtime'),
    `live_search.live.status beklenmeyen: ${bSearch?.live?.status}`,
  );
  assert(bSearch.live.visits.length === 0, 'Chrome yokken live_search gezinme kaydı döndü');
  const bBad = await B.call('live_search', { maxPages: 11 });
  assert(bBad.result?.isError === true || bBad.error, 'maxPages 11 reddedilmedi');
  B.child.kill();

  // ---- Koşu C: dist modülleri süreç içinde, sahte sayfa kaynağı ----
  const cHome = fs.mkdtempSync(path.join(tmpRoot, 'C-'));
  process.env.SAHIBINDEN_MCP_HOME = cHome;
  const distImport = (rel) => import(pathToFileURL(path.join(root, 'dist', rel)).href);
  const { createServer } = await distImport('server.js');
  const { BrowserProvider } = await distImport('providers/browser-provider.js');
  const { ImportProvider } = await distImport('providers/import-provider.js');
  const { RateLimiter } = await distImport('browser/rate-limiter.js');
  const { loadBrowserConfig } = await distImport('browser/browser-config.js');
  const { JsonStore } = await distImport('store/json-store.js');
  const fx = (n) => fs.readFileSync(path.join(root, 'tests/fixtures', n), 'utf8');

  const cfg = loadBrowserConfig({ SAHIBINDEN_BROWSER_MODE: 'on' }, cHome);
  const store = new JsonStore(path.join(cHome, 'store.json'));
  const importProvider = new ImportProvider({ store, inboxDir: path.join(cHome, 'inbox'), now: () => new Date().toISOString() });
  let clock = Date.now();
  const navigated = [];
  const pages = [fx('search.synthetic.html'), fx('listing.synthetic.html')];
  const fakeSource = {
    connect: async () => ({
      version: async () => 'Chrome/fake',
      attachTab: async () => null,
      close: async () => {},
      openTab: async () => {
        let html = '';
        return {
          targetId: 'T1',
          navigate: async (url) => {
            navigated.push(url);
            html = pages.shift() ?? '';
            return { finalUrl: url, httpStatus: 200, cfMitigated: false, errorText: null, quickKind: 'ready' };
          },
          html: async () => html,
          currentKind: async () => 'ready',
          close: async () => {},
        };
      },
    }),
  };
  const liveProvider = new BrowserProvider({
    config: cfg,
    importProvider,
    store,
    source: fakeSource,
    limiter: new RateLimiter({
      statePath: cfg.statePath, minDelayMs: cfg.minDelayMs, hourlyCap: cfg.hourlyCap,
      challengeCooldownMs: cfg.challengeCooldownMs, now: () => clock, sleep: async (ms) => { clock += ms; },
    }),
    now: () => clock,
    runtimeSupported: () => true,
  });
  const server = createServer({
    provider: importProvider, nowYear: () => new Date().getFullYear(), store, now: () => new Date(), live: liveProvider,
  });
  const replies = new Map();
  const transport = {
    start: async () => {},
    close: async () => {},
    send: async (m) => { if (m.id !== undefined) replies.get(m.id)?.(m); },
  };
  await server.connect(transport);
  let cid = 0;
  const creq = (method, params) =>
    new Promise((resolve) => {
      const id = ++cid;
      replies.set(id, resolve);
      transport.onmessage({ jsonrpc: '2.0', id, method, params });
    });
  await creq('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  transport.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const cNames = ((await creq('tools/list')).result?.tools ?? []).map((t) => t.name).sort();
  assert(cNames.length === 10, `koşu C: 10 tool bekleniyordu, ${cNames.length}`);

  const cSearch = (await creq('tools/call', { name: 'live_search', arguments: { models: ['Golf'], maxPages: 1 } })).result?.structuredContent;
  assert(cSearch?.live?.status === 'ok', `koşu C live_search durumu: ${cSearch?.live?.status}`);
  assert(cSearch.live.visits[0]?.pageType === 'search' && cSearch.live.visits[0].imported === 3, 'koşu C: arama sayfası içe aktarılmadı');
  assert(cSearch.results.length >= 1 && Array.isArray(cSearch.appliedFilters), 'koşu C: live_search sonucu/appliedFilters eksik');
  assert(cSearch.live.freshIds.length === 3, 'koşu C: freshIds != 3');
  const cGet = (await creq('tools/call', { name: 'live_get_listings', arguments: { refs: ['1000000001'] } })).result?.structuredContent;
  assert(cGet?.live?.status === 'ok' && cGet.items?.[0]?.state === 'imported', 'koşu C: live_get_listings detay içe aktarmadı');
  const cListing = (await creq('tools/call', { name: 'get_listing', arguments: { ref: '1000000001' } })).result?.structuredContent;
  assert(cListing?.listing?.id === '1000000001', 'koşu C: get_listing detayı bulamadı');
  assert(navigated.length === 2 && navigated.every((u) => new URL(u).hostname === 'www.sahibinden.com'), 'koşu C: beklenmeyen gezinme');
  assert(!JSON.stringify(cSearch).includes('<html'), 'koşu C: çıktıda ham HTML');

  // ---- Koşu D: price_drops handler (sunucuya W4'te kaydedilir), dist modülleri, geçici store ----
  const { priceDropsHandler, priceDropsInput, priceDropsOutput } = await distImport('tools/price-drops.js');
  const { getListingHandler, getListingInput, getListingOutput } = await distImport('tools/get-listing.js');
  const dStore = new JsonStore(path.join(fs.mkdtempSync(path.join(tmpRoot, 'D-')), 'store.json'));
  const dProvider = new ImportProvider({ store: dStore, inboxDir: path.join(cHome, 'inbox'), now: () => new Date().toISOString() });
  const dItem = {
    id: '1000000009', url: 'https://www.sahibinden.com/ilan/vasita-otomobil-ornek-1000000009/detay', title: 'ORNEK', brand: null, series: null,
    model: null, year: 2011, km: 176000, color: null, price: 745000, currency: 'TL', city: 'Samsun', district: null,
    listingDate: null, transmission: null, fuel: null, source: 'search', capturedAt: '2026-11-01T12:00:00.000Z',
  };
  dStore.upsertSummary(dItem);
  dStore.upsertSummary({ ...dItem, price: 715000, capturedAt: '2026-11-09T12:00:00.000Z' });
  dStore.upsertSummary(dItem); // yeniden okuma sahte düşüş/artış üretmez
  const dNow = () => new Date('2026-11-18T12:00:00.000Z');
  const dOut = priceDropsOutput.parse(await priceDropsHandler(priceDropsInput.parse({}), { store: dStore, now: dNow }));
  assert(dOut.drops.length === 1 && dOut.drops[0].dropTl === 30000 && dOut.drops[0].dropPct === 4, 'koşu D: price_drops düşüşü bulamadı');
  assert(!JSON.stringify(dOut).includes('kaldırıldı'), 'koşu D: kesin kaldırıldı hükmü');
  const dEmpty = priceDropsOutput.parse(
    await priceDropsHandler(priceDropsInput.parse({}), { store: new JsonStore(path.join(tmpRoot, 'D-empty.json')), now: dNow }),
  );
  assert(dEmpty.drops.length === 0 && dEmpty.notes[0].includes('Store boş'), 'koşu D: boş store sonucu beklenenden farklı');
  const dGet = getListingOutput.parse(
    await getListingHandler(getListingInput.parse({ ref: '1000000009' }), { provider: dProvider, store: dStore, now: dNow }),
  );
  assert(dGet.tracking?.priceHistory.length === 2 && dGet.tracking.lifecycle.status === 'seen-recently', 'koşu D: get_listing.tracking eksik');

  finish(0, 'SMOKE OK');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
