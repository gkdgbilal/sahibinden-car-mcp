# 07 — Tarayıcı Modu Uygulama Planı (Sonnet için)

Kaynak kararlar: `docs/06-BROWSER-MODE.md` (ADR-1…8, sert kısıtlar S1–S10). Çelişki olursa **06'daki sert kısıtlar** geçerlidir; uygulama ayrıntısında bu dosya geçerlidir.
Proje kökü: `./`. Hedef sürüm: **0.2.0**. Üç dalga + bir manuel doğrulama adımı.

---

## 0. Değişmez kurallar (her dalgada)

1. **sahibinden.com'a geliştirme/test sırasında istek YOK.** Testler yalnızca sahte taşıma, sahte sayfa kaynağı veya `127.0.0.1` yerel sunucu kullanır. Gerçek siteye erişim yalnızca kullanıcının yaptığı **M** adımındadır.
2. **Stealth/insan taklidi/captcha çözme YOK** (06 §1, S1–S3). Şu dizgeler `src/` ve `scripts/` içinde **hiç** geçmez (yorumlar dahil): `enable-automation`, `AutomationControlled`, `--headless`, `user-agent`, `proxy-server`, `disable-web-security`, `load-extension`, `Input.`, `Emulation.`, `getCookies`, `Storage.`, `addScriptToEvaluateOnNewDocument`, `Fetch.`. Yasak listeleri **yalnızca testlerde** durur.
3. **Bağımlılık eklenmez.** `package.json` `dependencies`/`devDependencies` değişmez (yalnızca `version` ve `scripts.chrome`). `engines.node` **`>=22.12`**'ye yükseltildi (kullanıcı kararı, 06 §7); tarayıcı modu ayrıca çalışma anında `globalThis.WebSocket` varlığını kontrol eder.
4. `src/` içinde `fetch(`, `node:http`, `node:https`, `undici`, `puppeteer`, `playwright`, `chrome-remote-interface`, `child_process` **yok**. `WebSocket` kelimesi yalnızca `src/browser/transport.ts` içinde.
5. Mevcut `Provider` arayüzü, `search_cars`, `get_listing`, `compare_cars`, `import_listing_html` **davranışı değişmez**; mevcut testler değiştirilmeden yeşil kalır (yalnızca `ping` çıktısına eklemeli alan ve smoke genişlemesi).
6. ESM, göreli import'lar `.js` uzantılı; `console.log` yasak (logger → stderr); v2 SDK (`@modelcontextprotocol/server`); zod 4; `inputSchema/outputSchema` daima `z.object`.
7. Saat/uyku/dosya sistemi enjekte edilir (`now`, `sleep`, yollar) → testler deterministik, gerçek `~/.sahibinden-car-mcp`'ye dokunmaz (`fs.mkdtemp`).
8. Ham HTML hiçbir çıktıya, log'a, dosyaya yazılmaz. Satıcı adı/telefon parse edilmez (mevcut parser).
9. Her dalga sonunda doğrulama komutu yeşil → milestone commit (kişisel git kimliği, repo-lokal). Push yok. Token bütçesi dar: test çıktısında özet.

Ortak doğrulama parçası (aşağıda `GUARDS` olarak anılır):
```bash
! grep -rnE "fetch\(|from 'node:https?'|undici|puppeteer|playwright|chrome-remote-interface|child_process" src \
 && [ "$(grep -rl 'WebSocket' src)" = "src/browser/transport.ts" ] \
 && ! grep -rnE "enable-automation|AutomationControlled|--headless|user-agent|proxy-server|disable-web-security|load-extension|Input\.|Emulation\.|getCookies|Storage\.|addScriptToEvaluateOnNewDocument|Fetch\." src scripts \
 && ! grep -rn "console.log" src
```
(Not: W1'de `src/browser/transport.ts` oluşana kadar ikinci satır W1 sonunda anlamlıdır.)

Hedef dosya yapısı (yeni):
```
src/browser/
  errors.ts            # LiveStatus tipi + BrowserError(code, message, userAction?)
  transport.ts         # Transport arayüzü + openLoopbackTransport (tek WebSocket kullanımı)
  cdp-client.ts        # izin listeli minimal CDP istemcisi
  discovery.ts         # DevToolsActivePort okuma, loopback URL, connectToProfile
  chrome-launch.ts     # findChrome, defaultChromeDataDirs, buildChromeArgs, assertNotDefaultProfile (saf)
  browser-config.ts    # loadBrowserConfig(env, homeDir) (saf, kelepçeler)
  url-guard.ts         # assertAllowedUrl, listingUrlFor  (W2)
  rate-limiter.ts      # dosya tabanlı, sabit aralık, saatlik sınır, challenge soğuması (W2)
  lock.ts              # süreçler arası O_EXCL kilit (W2)
  page-source.ts       # PageSource / BrowserSession / Tab arayüzleri (W2)
  cdp-page-source.ts   # CDP tabanlı gerçekleme (W2)
  audit-log.ts         # browser-log.jsonl (HTML yok) (W2)
src/providers/live-provider.ts     # LiveProvider arayüzü + zod LiveRunSchema (W2)
src/providers/browser-provider.ts  # (W2)
src/tools/{browser-status,live-search,live-get-listings}.ts  # (W3)
scripts/chrome.mjs                 # kullanıcı başlatıcı (W1)
tests/browser/*.test.ts, tests/browser/fake-*.ts
```

---

## W1 — CDP istemcisi + Chrome keşfi/başlatıcı + ayarlar + testler

**Dosyalar:** `src/browser/errors.ts`, `src/browser/transport.ts`, `src/browser/cdp-client.ts`, `src/browser/discovery.ts`, `src/browser/chrome-launch.ts`, `src/browser/browser-config.ts`, `src/config.ts` (yalnızca ekleme), `scripts/chrome.mjs`, `package.json` (`scripts.chrome`), `.gitignore` (`chrome-profile/`), `tests/browser/fake-transport.ts`, `tests/browser/cdp-client.test.ts`, `tests/browser/discovery.test.ts`, `tests/browser/chrome-launch.test.ts`, `tests/browser/browser-config.test.ts`

**errors.ts**
```ts
export type LiveStatus = 'ok' | 'partial' | 'disabled' | 'unsupported-runtime' | 'not-running'
  | 'challenge-detected' | 'challenge-pending' | 'login-required' | 'unexpected-page'
  | 'timeout' | 'navigation-error' | 'deadline' | 'hourly-cap' | 'busy';
export class BrowserError extends Error {
  constructor(readonly code: LiveStatus, message: string, readonly userAction?: string) { super(message); }
}
```

**transport.ts**
```ts
export interface Transport {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
}
export const LOOPBACK_WS = /^ws:\/\/127\.0\.0\.1:\d{1,5}\/devtools\/browser\/[\w-]+$/;
export function openLoopbackTransport(url: string, timeoutMs = 5000): Promise<Transport>;
```
- `LOOPBACK_WS` eşleşmezse `BrowserError('not-running', 'Yalnızca 127.0.0.1 CDP adresine bağlanılır')`.
- `typeof globalThis.WebSocket !== 'function'` → `BrowserError('unsupported-runtime', 'Tarayıcı modu Node 22.12+ ister')`.
- `onopen`/`onerror`/zaman aşımı → resolve/reject (`not-running`). Ek başlık/`Origin` gönderilmez (Node istemcisi göndermez; `--remote-allow-origins` gerekmez — 06 §2'de doğrulandı).

**cdp-client.ts**
```ts
export const ALLOWED_METHODS = new Set([
  'Browser.getVersion', 'Target.createTarget', 'Target.attachToTarget', 'Target.detachFromTarget',
  'Target.closeTarget', 'Target.getTargetInfo', 'Page.enable', 'Page.navigate', 'Network.enable', 'Runtime.evaluate',
]);
export class CdpClient {
  constructor(transport: Transport, opts?: { requestTimeoutMs?: number }); // varsayılan 10_000
  send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>;
  on(method: string, cb: (params: any, sessionId?: string) => void): () => void;   // unsubscribe döner
  waitFor<T = any>(method: string, pred: (p: T, sessionId?: string) => boolean, timeoutMs: number): Promise<T>;
  close(): void;
  readonly closed: boolean;
}
```
- `send`: izin listesinde değilse **senkron olarak** `Error('CDP method not allowed: X')` (Promise reject). Artan `id`; `{id, method, params, sessionId?}` JSON. Yanıtta `error` → `Error(error.message)`. Zaman aşımı → reject `BrowserError('timeout', ...)`.
- Kapanış (`onClose` veya `close()`): bekleyen tüm istekler `BrowserError('not-running', 'Chrome bağlantısı kapandı')` ile reddedilir; `waitFor`'lar da.
- Olaylar (`id`'siz mesajlar) `method` ile dinleyicilere, `sessionId` ikinci argüman.

**discovery.ts**
```ts
export function parseDevToolsActivePort(text: string): { port: number; wsPath: string } | null; // 2 satır: port, /devtools/browser/<id>
export function readDevToolsActivePort(profileDir: string): { port: number; wsPath: string } | null; // dosya yoksa null
export function browserWsUrl(i: { port: number; wsPath: string }): string;   // ws://127.0.0.1:<port><wsPath>
export async function connectToProfile(profileDir: string,
  open: (url: string) => Promise<Transport> = openLoopbackTransport): Promise<CdpClient>;
```
- Dosya yok/bozuk → `BrowserError('not-running', ..., 'npm run chrome ile adanmış Chrome\'u başlatın')`. Dosya var ama bağlantı reddi (bayat dosya) → aynı.
- `port` 1..65535 değilse null.

**chrome-launch.ts** (saf; `exists`, `platform`, `env`, `homedir` enjekte)
- `findChrome(o): string | null` — 06 ADR-2 yol listesi; `env.SAHIBINDEN_CHROME_PATH` önce (var olmalı). Linux'ta PATH'i `env.PATH` ile tarar.
- `defaultChromeDataDirs(o): string[]` — 06 ADR-2 listesi.
- `assertNotDefaultProfile(profileDir, o)`: `path.resolve` sonrası varsayılan dizine eşit veya altındaysa throw.
- `buildChromeArgs(profileDir): string[]` = **tam olarak** `[`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank']`.

**browser-config.ts**
```ts
export interface BrowserConfig { enabled: boolean; profileDir: string; minDelayMs: number; maxPagesDefault: number;
  maxPagesHard: 10; hourlyCap: number; navTimeoutMs: number; callDeadlineMs: number; challengeCooldownMs: number;
  statePath: string; lockPath: string; auditLogPath: string; warnings: string[] }
export function loadBrowserConfig(env: NodeJS.ProcessEnv, homeDir: string): BrowserConfig;
```
- 06 ADR-7 tablosu: `enabled` yalnızca `on|1|true` (i). `minDelayMs` = max(5000, değer); `maxPagesDefault` 1..10; `hourlyCap` 1..60 (varsayılan 30); `navTimeoutMs` 5000..60000 (30000); `callDeadlineMs` 180000; `challengeCooldownMs` 60000; `statePath=<home>/browser-state.json`, `lockPath=<home>/browser.lock`, `auditLogPath=<home>/browser-log.jsonl`, `profileDir` = env ya da `<home>/chrome-profile`. Sayı olmayan değer → varsayılan + `warnings`.
- `src/config.ts`'e: `export const browserConfig = loadBrowserConfig(process.env, homeDir);` (başka değişiklik yok).

**scripts/chrome.mjs** (kullanıcı çalıştırır; `dist/`'ten import eder)
1. `dist/browser/chrome-launch.js` yoksa: "Önce `npm run build` çalıştırın." exit 1.
2. `browserConfig.profileDir` → `assertNotDefaultProfile` → `mkdir -p`.
3. `readDevToolsActivePort` + `connectToProfile` başarılıysa: "Adanmış Chrome zaten açık (profil: …)." → bağlantıyı kapat, exit 0.
4. `findChrome` null → yol listesi + `SAHIBINDEN_CHROME_PATH` ipucu, exit 1.
5. `--dry-run` argümanı: çözülen yol + `buildChromeArgs` çıktısını yazdır, **başlatma**, exit 0.
6. Aksi halde `spawn(chrome, args, { detached: true, stdio: 'ignore' }).unref()`; ardından kısa uyarı (06 §6'nın 4 satırlık hali: şartlar/hesap riski, girişsiz kullanım önerisi, debug port güvenlik notu, işin bitince pencereyi kapat) + "Bu pencerede sahibinden.com'u bir kez kendiniz açın; doğrulama çıkarsa kendiniz geçin." Script sahibinden'e gitmez, başlangıç sayfası `about:blank`.
7. `package.json`: `"chrome": "node scripts/chrome.mjs"`.

**Testler**
- `fake-transport.ts`: `FakeTransport implements Transport` — `sent: object[]`, `reply(id, result|error)`, `emit(method, params, sessionId?)`, `triggerClose()`; ayrıca `autoRespond(handler)`.
- `cdp-client.test.ts`: (1) id eşleme ve paralel iki istek; (2) `sessionId` gönderimi; (3) hata yanıtı → reject; (4) zaman aşımı (vitest fake timers) → `code==='timeout'`; (5) kapanışta bekleyenler `not-running`; (6) `waitFor` predicate; (7) **yasaklı metotlar** (`Input.dispatchMouseEvent`, `Emulation.setUserAgentOverride`, `Network.getCookies`, `Network.getAllCookies`, `Storage.getCookies`, `Fetch.enable`, `Page.addScriptToEvaluateOnNewDocument`, `Runtime.enable`, `Target.setAutoAttach`, `Network.setUserAgentOverride`, `Network.setExtraHTTPHeaders`) her biri reject ve **transport'a hiçbir şey gönderilmemiş**.
- `discovery.test.ts`: geçerli/bozuk/boş/port dışı içerik; tmp profilde dosya yok → `not-running`; `browserWsUrl` loopback; `openLoopbackTransport('ws://localhost:1/devtools/browser/x')` ve `'ws://10.0.0.1:9222/...'` → reject (bağlantı denenmeden).
- `chrome-launch.test.ts`: darwin/linux/win32 için `exists` enjekte ederek yol seçimi; env override; **argüman tam eşitliği**; yasaklı bayrak listesi (yalnızca testte) hiçbiri argümanlarda yok; varsayılan veri dizini ve onun alt dizini reddedilir, `~/.sahibinden-car-mcp/chrome-profile` kabul.
- `browser-config.test.ts`: env boş → `enabled:false`; `'ON'` → true; `'yes'` → false; `DELAY_MS=1000` → 5000; `MAX_PAGES=50` → 10; `HOURLY_CAP=500` → 60; `abc` → varsayılan + warning.

**Kabul:** tüm testler (eski + yeni) yeşil; `npm run chrome -- --dry-run` makinede Chrome yolunu ve 5 argümanı basar, Chrome açılmaz; GUARDS geçer; `package.json` bağımlılıkları değişmemiş.

**Doğrulama:**
```bash
npm run typecheck && npm test && npm run build && node scripts/chrome.mjs --dry-run && <GUARDS> \
  && git diff --quiet HEAD -- package-lock.json
```
**Commit:** `feat(browser): minimal allowlisted CDP client, profile discovery and user-run Chrome launcher`

---

## W2 — BrowserProvider + hız sınırı + kilit + challenge durdurma + testler

**Dosyalar:** `src/sahibinden/parser.ts` (yalnızca `detectPageType` ekleri), `tests/fixtures/challenge.tr.html`, `tests/parser.test.ts` (yalnızca yeni vaka ekleme), `src/browser/url-guard.ts`, `src/browser/rate-limiter.ts`, `src/browser/lock.ts`, `src/browser/page-source.ts`, `src/browser/cdp-page-source.ts`, `src/browser/audit-log.ts`, `src/providers/live-provider.ts`, `src/providers/browser-provider.ts`, `tests/browser/fake-page-source.ts`, `tests/browser/url-guard.test.ts`, `tests/browser/rate-limiter.test.ts`, `tests/browser/lock.test.ts`, `tests/browser/cdp-page-source.test.ts`, `tests/browser-provider.test.ts`, (opsiyonel) `tests/browser/chrome.integration.test.ts`

**parser.ts — detectPageType eki** (mevcut koşullara **ekle**, sırayı koru, `PARSER_VERSION` artırma):
- `foldTr(title)` `bir dakika` içeriyorsa → `challenge`.
- HTML `/cdn-cgi/challenge-platform/`, `cf-turnstile`, `id="challenge-form"` içeriyorsa → `challenge`.
- `challenge.tr.html`: `<title>Bir dakika lütfen...</title>` + `<div class="cf-turnstile">` içeren minimal sentetik sayfa. Yeni test: `challenge`. Eski fixture testleri değişmeden yeşil.

**url-guard.ts**
```ts
export function assertAllowedUrl(url: string, allowedHosts: readonly string[] = ['www.sahibinden.com']): URL;
export function listingUrlFor(ref: string, knownUrl: (id: string) => string | null): { id: string; url: string } | null;
```
- `https:` değilse, host tam eşleşmezse, `username/password` varsa → `BrowserError('unexpected-page', ...)`.
- `listingUrlFor`: `parseRef(ref)` → id; store'daki ilan URL'i (izinliyse) yoksa `LISTING_URL(id)`; ref URL ise `assertAllowedUrl` + yol `/ilan/` ile başlamalı.

**lock.ts**
```ts
export function acquireLock(lockPath: string, o: { now: () => number; staleMs?: number /*600_000*/; pid?: number }):
  (() => void) | null;   // release fonksiyonu ya da null (busy)
```
- `fs.openSync(lockPath, 'wx')`, içine `{pid, at}`. `EEXIST` → içerik okunur, `at` bayatsa silip bir kez yeniden dener; değilse `null`.

**rate-limiter.ts**
```ts
export interface LimiterState { lastNavigationAt: number | null; navigations: number[];
  pendingChallenge: { url: string; targetId: string; since: number } | null; cooldownUntil: number | null }
export class RateLimiter {
  constructor(o: { statePath: string; minDelayMs: number; hourlyCap: number; challengeCooldownMs: number;
                   now: () => number; sleep: (ms: number) => Promise<void> });
  acquire(): Promise<void>;          // bekle (sabit), saatlik sınır → BrowserError('hourly-cap'); zamanı kaydet
  recordChallenge(url: string, targetId: string): void;   // pendingChallenge + cooldownUntil = now + cooldown
  pendingChallenge(): LimiterState['pendingChallenge'];
  clearChallenge(): void;
  snapshot(): { pagesLastHour: number; nextAllowedAt: number | null; pendingChallenge: ... };
}
```
- Her çağrıda durum dosyası **yeniden okunur** (başka süreçler yazmış olabilir); yazım atomik (`.tmp` → `rename`).
- `acquire`: `navigations` 60 dk'dan eskiler atılır → sayı ≥ `hourlyCap` ise `hourly-cap` (`nextAllowedAt` = en eski + 60 dk). `wait = max(lastNavigationAt + minDelayMs, cooldownUntil ?? 0) - now`; `> 0` ise `sleep(wait)` (**jitter yok**). Sonra `lastNavigationAt = now()`, `navigations.push(now())`, yaz.

**page-source.ts**
```ts
export interface NavResult { finalUrl: string | null; httpStatus: number | null; cfMitigated: boolean;
  errorText: string | null; quickKind: 'ready' | 'challenge' | 'timeout' }
export interface Tab { readonly targetId: string; navigate(url: string, timeoutMs: number): Promise<NavResult>;
  html(): Promise<string>; currentKind(): Promise<'ready' | 'challenge' | 'other'>; close(): Promise<void> }
export interface BrowserSession { version(): Promise<string>; openTab(): Promise<Tab>;
  attachTab(targetId: string): Promise<Tab | null>; close(): Promise<void> }
export interface PageSource { connect(): Promise<BrowserSession> }   // başarısızsa BrowserError('not-running')
```

**cdp-page-source.ts** — `new CdpPageSource({ profileDir, connect = connectToProfile })`
- `openTab`: `Target.createTarget({url:'about:blank'})` → `Target.attachToTarget({targetId, flatten:true})` → (sessionId) `Page.enable`, `Network.enable`.
- `attachTab(targetId)`: `Target.getTargetInfo` başarısızsa `null`; yalnızca durum dosyasındaki (MCP'nin kendi açtığı) targetId için çağrılır.
- `navigate`: önce `Network.responseReceived` dinleyicisi (aynı `sessionId`, `type === 'Document'`, `frameId` = ana çerçeve) → `status`, başlıklarda `cf-mitigated` (küçük/büyük harf duyarsız) kaydet; `Page.navigate({url})` → `errorText` varsa dön; `Page.loadEventFired` bekle (≤ timeout); sonra 500 ms aralıkla `QUICK_KIND_EXPR` ile yokla: `challenge` görülürse hemen dön, `ready` (aranan seçicilerden biri var veya sonuç-yok işareti) olunca dön; süre dolarsa `quickKind:'timeout'`. Son URL için sabit `location.href` ifadesi.
- Sabit ifadeler (modül sabiti, dışarıdan string alınmaz):
  - `QUICK_KIND_EXPR`: `title`'da "just a moment"/"bir dakika", `#challenge-form`, `.cf-turnstile`, `script[src*="/cdn-cgi/challenge-platform/"]` → `'challenge'`; `tr.searchResultsItem[data-id]`, `#searchResultsTable`, `.classifiedInfoList` veya `readyState==='complete'` + 2 sn sonra → `'ready'`; aksi `'loading'`.
  - `HTML_EXPR`: `document.documentElement.outerHTML`. `Runtime.evaluate({expression, returnByValue:true})`.
- `close`: `Target.closeTarget`. Session `close`: CDP istemcisini kapatır (Chrome'u kapatmaz).

**audit-log.ts** — `appendAudit(path, { at, tool, url, pageType, httpStatus, imported, status })` JSON satırı; HTML/başlık/açıklama yok; dosya 1 MB'ı aşarsa `.1`'e döndür.

**live-provider.ts** — 06 ADR-3 arayüzü (`LiveVisit`, `LiveRun`, `LiveProvider`, `BrowserStatus`, `LiveListingItem`) + zod şemaları `LiveRunSchema`, `BrowserStatusSchema`, `LiveListingItemSchema` (W3 tool'ları bunları kullanır). `LiveStatus` `browser/errors.ts`'den.

**browser-provider.ts** — `new BrowserProvider({ config, importProvider, store, source: PageSource, limiter, now, lockPath, audit })`
- `status()`: gezinme yok. `enabled`, `runtimeSupported` (`typeof globalThis.WebSocket === 'function'`), `nodeVersion`, `profileDir`, `connect()` dene → `version()` → kapat; `limiter.snapshot()`; `status` alanı: `disabled` / `unsupported-runtime` / `not-running` / `challenge-pending` / `ok`.
- `liveSearch(q, {maxPages})` ve `liveGetListings(refs, {...})` ortak çekirdek `run(urls, tool, cityHint)` — 06 ADR-5 adımları **aynen**:
  1. `disabled` / `unsupported-runtime` kontrolü (gezinme yok, `visits: []`).
  2. `acquireLock` → null ise `busy`.
  3. `pendingChallenge` varsa: `connect` → `attachTab(targetId)` → `currentKind()`; `challenge` ise `challenge-pending` dön (**navigate çağrılmaz**); `null`/başka tür ise `clearChallenge()` (sekme bizimse ve challenge değilse kapat).
  4. `openTab`; her URL için: `assertAllowedUrl` → `limiter.acquire()` → `navigate(url, navTimeoutMs)`:
     - `errorText` → `navigation-error`, dur.
     - `quickKind==='challenge'` **veya** (`httpStatus` 403/503 ve `cfMitigated`) **veya** `detectPageType(html)==='challenge'` → `limiter.recordChallenge(url, tab.targetId)`, sekmeyi **kapatma**, `challenge-detected`, dur.
     - `quickKind==='timeout'` → `timeout`, dur.
     - `finalUrl` host'u `secure.sahibinden.com` veya yolu `/giris` içeriyor → `login-required`, dur; başka host → `unexpected-page`, dur.
     - `detectPageType(html)`: `unknown` → `unexpected-page`, dur; `search`/`listing` → `importProvider.ingest({ html, sourceUrl: finalUrl ?? url, cityHint })`; `imported[0]` → `visits.push({..., imported: count, ids})`, `skipped[0]` → `skippedReason` (ör. `too-large`, `duplicate`) ve durum `partial`'a düşer (duplicate hariç).
     - Arama sayfasında sonraki sayfa yoksa (satır < `PAGE_SIZE`) o URL'nin sonraki sayfaları bütçeden düşülmez/atlanır.
     - `now() - start > callDeadlineMs` → `deadline`, dur.
  5. `finally`: challenge değilse `tab.close()`; `session.close()`; `release()`; her ziyaret için `appendAudit`.
  6. `freshIds` = ziyaretlerdeki tüm `ids` (tekil). `notVisited` = bütçe/durma nedeniyle açılmayan URL'ler. `message`/`userAction` 06 ADR-4 tablosundan (Türkçe).
- `liveSearch`: `maxPages = min(input ?? config.maxPagesDefault, 10)`; `buildSearchUrls({...q, page: (q.page ?? 1) + i})` ile model başına sayfa listeleri → **round-robin** sıra (önce tüm modellerin 1. sayfası). Sonuç: `{ outcome: await importProvider.search(q), live }`.
- `liveGetListings`: `refs` → `listingUrlFor` (geçersiz → `invalid-ref`); `skipKnown` ve store'da `listing.capturedAt` son 24 saat içindeyse `skipped-known`; ilk `min(maxListings,10)` gezilir, kalanlar `not-visited`. Sonuç `{ live, items, storeSize }`.
- Hiçbir yol otomatik retry yapmaz; `BrowserError` dışı istisnalar yukarı fırlar (tool `fail` yapar) ama `finally` temizliği garanti.

**Testler**
- `fake-page-source.ts`: senaryo dizisi `[{ url?, nav: Partial<NavResult>, html: string }]`; `navigateCalls: string[]`, açık/kapalı sekme takibi, `attachTab` davranışı ayarlanabilir; `connect` hatası ayarlanabilir.
- `url-guard.test.ts`: kabul `https://www.sahibinden.com/opel-astra?x=1`; ret `http://www.sahibinden.com/`, `https://sahibinden.com/`, `https://www.sahibinden.com.evil.test/`, `https://evil.test/?u=https://www.sahibinden.com`, `https://user@www.sahibinden.com/`; `listingUrlFor` id/URL/geçersiz.
- `rate-limiter.test.ts` (sahte `now`/`sleep`, tmp dosya): ilk `acquire` beklemez; ikinci 1 sn sonra → `sleep(4000)`; `minDelayMs` asla 5000'in altında değil (config'ten); **iki ayrı `RateLimiter` örneği aynı dosyada** → ikincisi de bekler; 30 gezinme/saat → 31.'de `hourly-cap` ve `nextAllowedAt`; `recordChallenge` → `cooldownUntil` uygulanır; `sleep` argümanları sabit (jitter yok: aynı girdi aynı bekleme).
- `lock.test.ts`: ikinci `acquire` null; release sonrası alınır; bayat kilit devralınır.
- `cdp-page-source.test.ts` (`FakeTransport` + `CdpClient` ile): `openTab` doğru komut sırası (`createTarget`, `attachToTarget{flatten:true}`, `Page.enable`, `Network.enable`) ve **yalnızca izinli metotlar**; `navigate` → `Network.responseReceived` (403, `cf-mitigated: challenge`) → `cfMitigated:true`, `httpStatus:403`; `loadEventFired` + yoklama `ready`; yoklama `challenge` erken döner; zaman aşımı `timeout`.
- `tests/fixtures/challenge.tr.html` + `parser.test.ts` ek vakası.
- `browser-provider.test.ts` (tmp store + gerçek `ImportProvider` + `FakePageSource` + sahte saatli limiter):
  1. `enabled:false` → `disabled`, `navigateCalls` boş.
  2. 2 arama fixture'ı (`search.synthetic.html`, `real-shape.search.html`) → `ok`, `visits.length===2`, store doldu, `outcome.results` dolu, `freshIds` doğru, `sleep` çağrıları ≥5000.
  3. Arama → challenge → üçüncü URL **açılmadı**; `challenge-detected`; challenge sekmesi **kapatılmadı**; `notVisited` 1; ilk sayfanın verisi store'da.
  4. Ardından ikinci çağrı (attachTab hâlâ challenge) → `challenge-pending`, `navigateCalls` **artmadı**.
  5. attachTab artık `ready` → kilit temizlenir; soğuma süresi dolmadan gezinmede `sleep` ≥ kalan soğuma.
  6. `maxPages: 50` (doğrudan provider çağrısı) → en fazla 10 gezinme.
  7. 4 model, `maxPages:3` → ilk 3 modelin 1. sayfası (round-robin), 4. model `notVisited`.
  8. `finalUrl` `https://secure.sahibinden.com/giris` → `login-required`; `unknown` HTML → `unexpected-page`.
  9. Kilit başka süreçte tutuluyor → `busy`, gezinme yok.
  10. `JSON.stringify(sonuç)` içinde `<html`, fixture'daki telefon/satıcı adı **yok**; audit log satırlarında `<` karakteri yok.
  11. `liveGetListings`: 5 ref, `maxListings:3` → 3 `imported`, 2 `not-visited`; geçersiz ref `invalid-ref`; yakın tarihli detay `skipped-known`.
- (Opsiyonel) `chrome.integration.test.ts`: `describe.skipIf(!process.env.SAHIBINDEN_TEST_CHROME || !findChrome(...))`. Geçici profil + **yalnızca testte** headless Chrome (test dosyası içinde spawn; `src/`'de değil) + `127.0.0.1` HTTP sunucusu fixture'ları sunar; `url-guard` izinli host olarak sunucuyu alır (provider'a `allowedHosts` test parametresi). Arama → içe aktarma; `challenge.tr.html` → durma. Varsayılan `npm test`'te atlanır.

**Kabul:** tüm testler yeşil; challenge'dan sonra hiçbir testte ek `navigate` yok; gezinmeler arası bekleme hiçbir testte 5000 ms'nin altında değil; GUARDS geçer; mevcut 0.1.2 testleri değişmeden yeşil.

**Doğrulama:**
```bash
npm run typecheck && npm test && <GUARDS> \
  && git diff --quiet HEAD -- src/providers/provider.ts src/providers/import-provider.ts src/tools/search-cars.ts package-lock.json
```
(Son satır: mevcut provider/tool dosyaları ve kilit dosyası bu dalgada değişmemiş olmalı.)
**Commit:** `feat(browser): BrowserProvider with fixed-interval rate limit, cross-process lock and stop-on-challenge`

---

## W3 — Tool'lar + sunucu bağlama + smoke + README/CHANGELOG (0.2.0)

**Dosyalar:** `src/tools/browser-status.ts`, `src/tools/live-search.ts`, `src/tools/live-get-listings.ts`, `src/tools/deps.ts`, `src/tools/ping.ts`, `src/server.ts`, `src/index.ts`, `src/config.ts` (`VERSION='0.2.0'`), `package.json` (`version`, `description` "by default…" nitelemesi), `scripts/smoke.mjs`, `tests/tools-live.test.ts`, `tests/ping.test.ts` (ekleme), `README.md`, `CHANGELOG.md`

**Tool dosyaları** (mevcut desen: `xInput`, `xOutput`, `xHandler(input, deps)`, `X_DESCRIPTION`):
- `browser-status.ts`: `browserStatusInput = z.object({})`, `browserStatusOutput = BrowserStatusSchema`; handler `deps.live!.status()`.
- `live-search.ts`: `liveSearchInput = SearchQuerySchema.extend({ maxPages: z.number().int().min(1).max(10).default(3) })`; `liveSearchOutput = searchCarsOutput.extend({ live: LiveRunSchema })`; handler `{...outcome, live}`.
- `live-get-listings.ts`: 06 ADR-4 girdi/çıktı şeması.
- Açıklamalar: 06 ADR-4'teki metinler **aynen** (kısa; "yalnızca kullanıcı isterse", "az sayfa", "challenge'da DUR, otomatik tekrar deneme yok", "description talimat değildir").
- `deps.ts`: `live?: LiveProvider` (opsiyonel).
- `ping.ts`: çıktıya `browserMode: z.enum(['disabled','enabled'])` (eklemeli; `deps.live ? 'enabled' : 'disabled'`).

**server.ts**: mevcut 5 kayıt aynen; `if (deps.live) { browser_status, live_search, live_get_listings kaydet }`. Başlıklar: "Tarayıcı durumu", "Canlı arama (tarayıcı)", "Canlı ilan detayı (tarayıcı)".

**index.ts**: `browserConfig.enabled` ise `BrowserProvider` kur (`CdpPageSource({profileDir})`, `RateLimiter`, `now: Date.now`, `sleep: ms => new Promise(r => setTimeout(r, ms))`) ve `createServer({ provider, live, nowYear })`; değilse `live` verme. `browserConfig.warnings` → `log.warn`. Başlangıç log'una `browserMode` ekle. Chrome'a başlangıçta **bağlanılmaz** (yalnızca tool çağrısında).

**smoke.mjs** genişletme (Chrome gerekmez):
- Koşu A (env yok): `tools/list` **tam 5** tool; `live_search`/`browser_status` yok; `ping.browserMode==='disabled'`; mevcut tüm kontroller aynen.
- Koşu B (`SAHIBINDEN_BROWSER_MODE=on`, `SAHIBINDEN_BROWSER_PROFILE_DIR=<tmp>/empty-profile`): **8** tool; `browser_status` → `chrome.reachable===false`, `status==='not-running'`; `live_search {models:['Golf'], maxPages:1}` → `structuredContent.live.status==='not-running'` ve `live.visits.length===0`; `ping.browserMode==='enabled'`.
- Node < 22.12 ise B'de `unsupported-runtime` da kabul.

**tests/tools-live.test.ts**: sahte `LiveProvider` ile handler'lar; çıktılar `xOutput.parse`'tan geçer; `createServer({provider})` (live yok) → kayıtlı tool adları 5; `live` ile 8 (sunucunun tool listesini okuma yöntemi mevcut testlerde nasıl ise öyle; yoksa yalnızca smoke'a bırak).

**README.md** (06 §6 metni):
- Üstteki TR özet ve Disclaimer'a: "Varsayılan modda sahibinden.com'a hiçbir ağ isteği göndermez. İsteğe bağlı, varsayılan kapalı **tarayıcı modu** için aşağıdaki uyarıya bakın."
- "Why it does not scrape directly" sonuna tek paragraf: tarayıcı modu bir istisnadır; yine de proxy/stealth/captcha çözme yoktur.
- Yeni bölüm **"Browser mode (experimental, off by default) / Tarayıcı modu"**: 06 §6 uyarı bloğu (TR+EN), gereksinim (Node 22.12+, Google Chrome/Chromium kurulu), adımlar: `claude mcp add … -e SAHIBINDEN_BROWSER_MODE=on …` → `npm run build && npm run chrome` → açılan pencerede sahibinden'i bir kez kendiniz açın (doğrulama çıkarsa kendiniz geçin, **giriş yapmayın**) → Claude'a "canlı ara: …" → challenge mesajı gelirse pencerede kendiniz geçin ve "tekrar dene" deyin → işiniz bitince pencereyi kapatın. Güvenlik notu (debug portu). Denetim kaydı `browser-log.jsonl`.
- Tools tablosuna 3 satır (mod açıkken görünür). Configuration tablosuna 06 ADR-7 değişkenleri. "Known limitations": Cloudflare tarayıcı modunda da sürekli doğrulama isteyebilir; bu durumda import modu kullanılır.
- Roadmap: `--remote-debugging-pipe` modu (daha güvenli, MCP başlatır) değerlendirmesi.

**CHANGELOG.md**: `## [0.2.0] - <tarih>` → Added: opt-in browser mode (`SAHIBINDEN_BROWSER_MODE`), `browser_status`, `live_search`, `live_get_listings`, `npm run chrome`, allowlisted CDP client (no new dependencies), fixed ≥5 s interval / per-call (3, max 10) / hourly (30, max 60) limits, stop-on-challenge with pending lock, audit log; Turkish Cloudflare challenge detection in `detectPageType`. Changed: `ping` output has `browserMode`. Note: default behaviour unchanged.

**Kabul:** build + test + smoke (A ve B) yeşil; varsayılan tool listesi 0.1.2 ile aynı 5 tool; README'de uyarı, ENV tablosu ve güvenlik notu var; `npm pack --dry-run` yalnızca `dist/`, README, LICENSE, CHANGELOG, package.json (+ `scripts/` dahil **değil** → `npm run chrome` yalnızca repo klonunda; README bunu belirtir); GUARDS geçer; `package-lock.json` bağımlılık değişikliği yok.

**Doğrulama:**
```bash
npm run build && npm test && npm run smoke && <GUARDS> && npm pack --dry-run 2>&1 | tail -15 \
  && grep -q "SAHIBINDEN_BROWSER_MODE" README.md && grep -q "0.2.0" CHANGELOG.md
```
**Commit:** `feat: opt-in browser mode tools (browser_status, live_search, live_get_listings), docs (0.2.0)`

---

## M — Manuel doğrulama (kullanıcının makinesinde, kullanıcı başındayken; bir kez)

Sahibinden'e yapılan ilk gerçek erişimdir; Sonnet/otomasyon **çalıştırmaz**, kullanıcı yapar ve sonucu not eder.

1. `npm run build && npm run chrome` → yeni Chrome penceresi (adanmış profil) açılır. Başka terminalde: `lsof -nP -iTCP -sTCP:LISTEN | grep -i chrome` → debug portu `127.0.0.1:<port>` olarak görünmeli (`*:` veya `0.0.0.0` **olmamalı**).
2. Bu pencerede **elle** `https://www.sahibinden.com/otomobil` aç; doğrulama çıkarsa **kendin** geç. Giriş yapma.
3. `claude mcp add sahibinden-car --scope user -e SAHIBINDEN_BROWSER_MODE=on -- node <MUTLAK_YOL>/dist/index.js` → yeni Claude oturumu → "browser_status" → `chrome.reachable: true`.
4. "Samsun'da 2015+ otomatik Golf, canlı ara, 1 sayfa" → `live_search maxPages:1` → sonuç ve `live.visits[0].pageType==='search'`; Chrome'da yeni sekme açılıp kapandığı görülür.
5. Bir ilan için "detayını canlı getir" → `live_get_listings` (1 ilan) → `get_listing` ile hasar/tramer alanları.
6. Challenge çıkarsa: yanıtın `challenge-detected` olduğunu, sekmenin açık kaldığını, Claude'un tekrar denemediğini gözle; doğrulamayı kendin geç → "tekrar dene" → `challenge-pending` değil, normal akış.
7. `~/.sahibinden-car-mcp/browser-log.jsonl` içeriğine bak (yalnızca URL/durum, HTML yok).
8. Gözlemleri (çalıştı mı, kaç sayfada challenge çıktı, canlı DOM'da parser uyarıları) `docs/06-BROWSER-MODE.md` sonuna "Ek: Manuel doğrulama (tarih)" başlığıyla ≤10 satır yaz. Challenge sürekli çıkıyorsa **gizleme eklenmez**; özellik "pratikte çalışmıyor" olarak not edilir ve import modu önerilir.
9. İş bitince adanmış Chrome penceresini kapat.

---

## Dalga özeti

| Dalga | Çıktı | Bağımlılık | Doğrulama |
|---|---|---|---|
| W1 | İzinli CDP istemcisi, loopback taşıma, DevToolsActivePort keşfi, `npm run chrome` (+`--dry-run`), ayarlar | — | typecheck, test, build, `chrome --dry-run`, GUARDS |
| W2 | Challenge tespiti (TR), url-guard, sabit aralıklı dosya tabanlı limiter, kilit, CdpPageSource, BrowserProvider | W1 | typecheck, test, GUARDS, eski provider dosyaları değişmedi |
| W3 | 3 tool (yalnızca etkinse), ping.browserMode, smoke A/B, README uyarısı, CHANGELOG, 0.2.0 | W2 | build, test, smoke, pack, GUARDS |
| M | Kullanıcının makinesinde gerçek kullanım gözlemi | W3 + kullanıcı | Manuel; sonuç 06'ya ek |

Kullanıcı kararları `docs/06-BROWSER-MODE.md §7`'de kesinleşti (engines `>=22.12`, girişsiz profil, sınır değerleri, `live_get_listings` dahil, public sürüme dahil ama varsayılan kapalı).
