import type { BrowserConfig } from '../browser/browser-config.js';
import type { AuditEntry } from '../browser/audit-log.js';
import { appendAudit } from '../browser/audit-log.js';
import { BrowserError } from '../browser/errors.js';
import type { LiveStatus } from '../browser/errors.js';
import { acquireLock } from '../browser/lock.js';
import type { BrowserSession, PageSource, Tab } from '../browser/page-source.js';
import type { RateLimiter } from '../browser/rate-limiter.js';
import { runtimeSupportsCdp } from '../browser/transport.js';
import { ALLOWED_HOSTS, assertAllowedUrl, listingUrlFor } from '../browser/url-guard.js';
import { detectPageType } from '../sahibinden/parser.js';
import type { SearchQuery } from '../sahibinden/types.js';
import { buildSearchUrls } from '../sahibinden/url-builder.js';
import { PAGE_SIZE } from '../sahibinden/url-schema.js';
import type { JsonStore } from '../store/json-store.js';
import type {
  BrowserStatus, LiveListingItem, LiveProvider, LiveRun, LiveVisit,
} from './live-provider.js';
import type { Provider, SearchOutcome } from './provider.js';

const DAY_MS = 86_400_000;
const HARD_MAX_PAGES = 10;

const TEXT: Record<LiveStatus, { message: string; userAction?: string }> = {
  ok: { message: 'Tamamlandı.' },
  partial: { message: 'Bir kısmı içe aktarılamadı (ayrıntı için visits[].skippedReason).' },
  disabled: {
    message: 'Tarayıcı modu kapalı.',
    userAction:
      "README'deki 'Tarayıcı modu' bölümünü okuyup SAHIBINDEN_BROWSER_MODE=on ile etkinleştirebilirsiniz.",
  },
  'unsupported-runtime': { message: 'Bu Node sürümünde tarayıcı modu desteklenmiyor.', userAction: 'Node 22.12+ gerekli.' },
  'not-running': { message: "Adanmış Chrome'a bağlanılamadı.", userAction: "npm run chrome ile adanmış Chrome'u başlatın." },
  'challenge-detected': {
    message: 'sahibinden doğrulama (Cloudflare) sayfası gösterdi; işlem durduruldu.',
    userAction:
      'Açık bırakılan Chrome sekmesinde doğrulamayı kendiniz geçin, sonra tekrar isteyin. Otomatik tekrar denenmez.',
  },
  'challenge-pending': {
    message: 'Önceki doğrulama sekmesi hâlâ doğrulama bekliyor; yeni gezinme yapılmadı.',
    userAction: 'Açık Chrome sekmesinde doğrulamayı kendiniz geçin, sonra tekrar isteyin.',
  },
  'login-required': {
    message: 'Sayfa giriş istiyor.',
    userAction: 'Bu işlem giriş istiyor; tarayıcı modu girişli kullanımı desteklemez.',
  },
  'unexpected-page': { message: 'Sayfa beklenen türde değil.', userAction: 'Sayfayı tarayıcıda kontrol edin.' },
  timeout: { message: 'Sayfa zamanında hazır olmadı.', userAction: 'Tekrar denemeden önce kullanıcıya sorun.' },
  'navigation-error': { message: 'Sayfa açılamadı (ağ/bağlantı sorunu).', userAction: 'Bağlantıyı kontrol edin.' },
  deadline: { message: 'Çağrı süresi doldu; kısmi sonuç döndü.' },
  'hourly-cap': { message: 'Saatlik sayfa sınırına ulaşıldı.', userAction: 'nextAllowedAt zamanına kadar bekleyin.' },
  busy: { message: 'Başka bir çağrı gezinme yapıyor.', userAction: 'Bitmesini bekleyin.' },
};

export interface BrowserProviderOptions {
  config: BrowserConfig;
  /** Sayfaları içe aktaran ve filtreleyen mevcut hat (ImportProvider). */
  importProvider: Provider;
  store: JsonStore;
  source: PageSource;
  limiter: RateLimiter;
  /** Epoch ms. */
  now: () => number;
  audit?: (e: AuditEntry) => void;
  /** Yalnızca testte: izinli host listesi. */
  allowedHosts?: readonly string[];
  /** Yalnızca testte: çalışma zamanı desteği. */
  runtimeSupported?: () => boolean;
}

/** Sayfa gruplarını (model başına bir grup) sırayla dolaşan sayaç: önce her grubun 1. sayfası, sonra 2. ... */
class Cursor {
  private pos: number[];
  private done: boolean[];
  private rr = 0;
  constructor(private readonly groups: string[][]) {
    this.pos = groups.map(() => 0);
    this.done = groups.map(() => false);
  }
  get total(): number {
    return this.groups.reduce((n, g) => n + g.length, 0);
  }
  next(): { g: number; i: number; url: string } | null {
    for (let k = 0; k < this.groups.length; k++) {
      const g = (this.rr + k) % this.groups.length;
      const i = this.pos[g]!;
      if (!this.done[g] && i < this.groups[g]!.length) {
        this.pos[g] = i + 1;
        this.rr = g + 1;
        return { g, i, url: this.groups[g]![i]! };
      }
    }
    return null;
  }
  exhaust(g: number): void {
    this.done[g] = true;
  }
  /** Durumu değiştirmeden sıradaki n gezintiyi (ve hiç açılmamış grupların ilk sayfasını) listeler. */
  remaining(n: number): string[] {
    const c = new Cursor(this.groups);
    c.pos = [...this.pos];
    c.done = [...this.done];
    c.rr = this.rr;
    const out: string[] = [];
    for (let k = 0; k < n; k++) {
      const j = c.next();
      if (!j) break;
      out.push(j.url);
    }
    this.groups.forEach((g, gi) => {
      if (this.pos[gi] === 0 && !this.done[gi] && g[0] && !out.includes(g[0])) out.push(g[0]);
    });
    return out;
  }
}

interface RunSpec {
  tool: 'live_search' | 'live_get_listings';
  groups: string[][];
  budget: number;
  cityHint?: string;
}

interface VisitRec {
  group: number;
  visit: LiveVisit;
}

export class BrowserProvider implements LiveProvider {
  private readonly hosts: readonly string[];

  constructor(private readonly o: BrowserProviderOptions) {
    this.hosts = o.allowedHosts ?? ALLOWED_HOSTS;
  }

  private supported(): boolean {
    return this.o.runtimeSupported ? this.o.runtimeSupported() : runtimeSupportsCdp();
  }

  private iso(ms: number | null | undefined): string | null {
    return typeof ms === 'number' ? new Date(ms).toISOString() : null;
  }

  async status(): Promise<BrowserStatus> {
    const { config: c, limiter } = this.o;
    const runtimeSupported = this.supported();
    const chrome: BrowserStatus['chrome'] = { reachable: false, version: null };
    let status: LiveStatus = 'ok';
    if (!c.enabled) status = 'disabled';
    else if (!runtimeSupported) status = 'unsupported-runtime';
    else {
      let session: BrowserSession | null = null;
      try {
        session = await this.o.source.connect();
        chrome.version = await session.version();
        chrome.reachable = true;
      } catch (err) {
        if (!(err instanceof BrowserError)) throw err;
        status = err.code === 'unsupported-runtime' ? 'unsupported-runtime' : 'not-running';
      } finally {
        await session?.close().catch(() => undefined);
      }
    }
    const snap = c.enabled ? limiter.snapshot() : { pagesLastHour: 0, nextAllowedAt: null, pendingChallenge: null };
    if (status === 'ok' && snap.pendingChallenge) status = 'challenge-pending';
    const t = TEXT[status];
    return {
      status,
      message: status === 'ok' ? 'Tarayıcı modu hazır.' : t.message,
      enabled: c.enabled,
      runtimeSupported,
      nodeVersion: process.version,
      profileDir: c.profileDir,
      chrome,
      rateLimit: {
        minDelayMs: c.minDelayMs,
        maxPagesPerCall: c.maxPagesDefault,
        pagesLastHour: snap.pagesLastHour,
        hourlyCap: c.hourlyCap,
        nextAllowedAt: this.iso(snap.nextAllowedAt),
      },
      pendingChallenge: snap.pendingChallenge
        ? { url: snap.pendingChallenge.url, since: new Date(snap.pendingChallenge.since).toISOString() }
        : null,
    };
  }

  async liveSearch(q: SearchQuery, opts: { maxPages?: number }) {
    const maxPages = Math.max(1, Math.min(opts.maxPages ?? this.o.config.maxPagesDefault, HARD_MAX_PAGES));
    const start = q.page ?? 1;
    // Sayfa i için her modelin URL'si; grup = model (buildSearchUrls aynı URL'leri birleştirir, sıra sayfadan bağımsızdır).
    const perPage = Array.from({ length: maxPages }, (_, i) => buildSearchUrls({ ...q, page: start + i }));
    const groups = (perPage[0] ?? []).map((_, g) => perPage.map((urls) => urls[g]!.url));
    const { live } = await this.run({ tool: 'live_search', groups, budget: maxPages, ...(q.city ? { cityHint: q.city } : {}) });
    const outcome: SearchOutcome = await this.o.importProvider.search(q);
    return { outcome, live };
  }

  async liveGetListings(refs: string[], opts: { maxListings?: number; skipKnown?: boolean }) {
    const maxListings = Math.max(1, Math.min(opts.maxListings ?? 3, HARD_MAX_PAGES));
    const skipKnown = opts.skipKnown ?? true;
    const nowMs = this.o.now();
    const items: LiveListingItem[] = refs.map((ref) => ({ ref, id: null, state: 'not-visited' as const }));
    const candidates: { index: number; id: string; url: string }[] = [];
    const seen = new Set<string>();
    const knownUrl = (id: string) => {
      const e = this.o.store.get(id);
      return e?.listing?.url ?? e?.summary?.url ?? null;
    };

    refs.forEach((ref, index) => {
      const target = listingUrlFor(ref, knownUrl);
      if (!target) {
        items[index] = { ref, id: null, state: 'invalid-ref' };
        return;
      }
      items[index] = { ref, id: target.id, state: 'not-visited', reason: 'budget' };
      if (seen.has(target.id)) {
        items[index] = { ref, id: target.id, state: 'skipped-known', reason: 'duplicate-ref' };
        return;
      }
      seen.add(target.id);
      const capturedAt = this.o.store.get(target.id)?.listing?.capturedAt;
      if (skipKnown && capturedAt && nowMs - Date.parse(capturedAt) < DAY_MS) {
        items[index] = { ref, id: target.id, state: 'skipped-known', reason: 'imported-within-24h' };
        return;
      }
      candidates.push({ index, id: target.id, url: target.url });
    });

    const chosen = candidates.slice(0, maxListings);
    const { live, visited } = await this.run({
      tool: 'live_get_listings',
      groups: chosen.map((c) => [c.url]),
      budget: chosen.length,
    });
    const reasonForUnvisited = live.status === 'ok' || live.status === 'partial' ? 'budget' : live.status;
    for (const c of candidates) {
      if (!chosen.includes(c)) items[c.index] = { ...items[c.index]!, reason: 'budget' };
      else items[c.index] = { ...items[c.index]!, reason: reasonForUnvisited };
    }
    for (const { group, visit } of visited) {
      const c = chosen[group]!;
      if (visit.imported > 0) items[c.index] = { ref: items[c.index]!.ref, id: c.id, state: 'imported' };
      else if (visit.skippedReason === 'duplicate') {
        items[c.index] = { ref: items[c.index]!.ref, id: c.id, state: 'skipped-known', reason: 'duplicate' };
      } else {
        items[c.index] = {
          ref: items[c.index]!.ref,
          id: c.id,
          state: 'failed',
          reason: visit.skippedReason ?? visit.pageType ?? 'not-imported',
        };
      }
    }
    return { live, items, storeSize: this.o.store.size() };
  }

  /** ADR-5: tek çağrılık gezinme çekirdeği. Otomatik retry yoktur; ilk sorunda durur. */
  private async run(spec: RunSpec): Promise<{ live: LiveRun; visited: VisitRec[] }> {
    const { config: cfg, limiter, source } = this.o;
    const visits: LiveVisit[] = [];
    const visited: VisitRec[] = [];
    const cursor = new Cursor(spec.groups);
    let navigations = 0;
    let status: LiveStatus = 'ok';
    let message: string | undefined;
    let userAction: string | undefined;
    let nextAllowedAt: number | null = null;
    let partial = false;
    let stoppedEarly = false;

    const result = (): { live: LiveRun; visited: VisitRec[] } => {
      const t = TEXT[status];
      const freshIds = [...new Set(visits.flatMap((v) => v.ids))];
      const notVisited = stoppedEarly ? cursor.remaining(Math.max(0, spec.budget - navigations)) : cursor.remaining(0);
      return {
        visited,
        live: {
          status,
          message: message ?? t.message,
          ...((userAction ?? t.userAction) ? { userAction: userAction ?? t.userAction } : {}),
          visits,
          notVisited,
          freshIds,
          nextAllowedAt: this.iso(nextAllowedAt),
        },
      };
    };

    if (!cfg.enabled) {
      status = 'disabled';
      return result();
    }
    if (!this.supported()) {
      status = 'unsupported-runtime';
      return result();
    }
    if (cursor.total === 0) {
      return result();
    }

    const release = acquireLock(cfg.lockPath, { now: this.o.now });
    if (!release) {
      status = 'busy';
      stoppedEarly = true;
      return result();
    }

    const startedAt = this.o.now();
    let session: BrowserSession | null = null;
    let tab: Tab | null = null;
    let keepTab = false;
    try {
      session = await source.connect();

      // Bekleyen doğrulama: yalnızca salt-okuma kontrol; hâlâ doğrulama ise yeni gezinme YOK.
      const pending = limiter.pendingChallenge();
      if (pending) {
        const old = await session.attachTab(pending.targetId);
        if (old && (await old.currentKind()) === 'challenge') {
          keepTab = true;
          status = 'challenge-pending';
          stoppedEarly = true;
          nextAllowedAt = limiter.snapshot().nextAllowedAt;
          tab = old;
          return result();
        }
        limiter.clearChallenge();
        if (old) await old.close().catch(() => undefined);
      }

      tab = await session.openTab();
      while (navigations < spec.budget) {
        if (this.o.now() - startedAt > cfg.callDeadlineMs) {
          status = 'deadline';
          stoppedEarly = true;
          break;
        }
        const job = cursor.next();
        if (!job) break;
        assertAllowedUrl(job.url, this.hosts);
        await limiter.acquire();
        navigations++;
        const t0 = this.o.now();
        const nav = await tab.navigate(job.url, cfg.navTimeoutMs);
        const visit: LiveVisit = {
          url: job.url,
          finalUrl: nav.finalUrl,
          pageType: null,
          httpStatus: nav.httpStatus,
          imported: 0,
          ids: [],
          ms: Math.max(0, this.o.now() - t0),
        };
        visits.push(visit);
        visited.push({ group: job.g, visit });
        const audit = (st: string) => this.writeAudit(spec.tool, visit, st);

        if (nav.errorText) {
          status = 'navigation-error';
          message = `Sayfa açılamadı: ${nav.errorText}`;
          stoppedEarly = true;
          audit(status);
          break;
        }

        const html = await tab.html();
        const pageType = detectPageType(html);
        visit.pageType = pageType;
        const cfBlocked = (nav.httpStatus === 403 || nav.httpStatus === 503) && nav.cfMitigated;
        if (nav.quickKind === 'challenge' || cfBlocked || pageType === 'challenge') {
          visit.pageType = 'challenge';
          limiter.recordChallenge(job.url, tab.targetId);
          keepTab = true; // doğrulamayı kullanıcı kendisi geçsin diye sekme açık kalır
          status = 'challenge-detected';
          nextAllowedAt = limiter.snapshot().nextAllowedAt;
          stoppedEarly = true;
          audit(status);
          break;
        }
        if (nav.quickKind === 'timeout') {
          status = 'timeout';
          message = `Sayfa ${Math.round(cfg.navTimeoutMs / 1000)} sn içinde hazır olmadı.`;
          stoppedEarly = true;
          audit(status);
          break;
        }

        const finalHost = this.hostOf(nav.finalUrl);
        const finalPath = this.pathOf(nav.finalUrl);
        if (finalHost === 'secure.sahibinden.com' || finalPath.includes('/giris')) {
          status = 'login-required';
          stoppedEarly = true;
          audit(status);
          break;
        }
        if (finalHost === null || !this.hosts.includes(finalHost) || pageType === 'unknown') {
          status = 'unexpected-page';
          stoppedEarly = true;
          audit(status);
          break;
        }

        // Ham HTML yalnızca bu blokta bellekte yaşar: loga, çıktıya veya diske yazılmaz.
        const report = await this.o.importProvider.ingest({
          html,
          sourceUrl: nav.finalUrl ?? job.url,
          ...(spec.cityHint ? { cityHint: spec.cityHint } : {}),
        });
        const imp = report.imported[0];
        const skip = report.skipped[0];
        if (imp) {
          visit.imported = imp.count;
          visit.ids = imp.ids;
        }
        let visitPartial = false;
        if (skip) {
          visit.skippedReason = skip.reason;
          if (skip.reason !== 'duplicate') visitPartial = partial = true;
        }
        audit(visitPartial ? 'partial' : 'ok');

        if (pageType === 'search' && (!imp || imp.count < PAGE_SIZE) && !(skip && skip.reason === 'duplicate')) {
          cursor.exhaust(job.g); // sonraki sayfa yok
        }
      }
      if (status === 'ok' && partial) status = 'partial';
    } catch (err) {
      if (!(err instanceof BrowserError)) throw err;
      status = err.code;
      message = err.message;
      if (err.userAction) userAction = err.userAction;
      if (err.nextAllowedAt !== undefined) nextAllowedAt = err.nextAllowedAt;
      stoppedEarly = true;
    } finally {
      if (tab && !keepTab) await tab.close().catch(() => undefined);
      await session?.close().catch(() => undefined);
      release();
    }
    if (nextAllowedAt === null && status !== 'ok' && status !== 'partial' && cfg.enabled) {
      try {
        nextAllowedAt = limiter.snapshot().nextAllowedAt;
      } catch {
        /* durum dosyası okunamadı */
      }
    }
    return result();
  }

  private hostOf(url: string | null): string | null {
    try {
      return url ? new URL(url).hostname : null;
    } catch {
      return null;
    }
  }

  private pathOf(url: string | null): string {
    try {
      return url ? new URL(url).pathname : '';
    } catch {
      return '';
    }
  }

  private writeAudit(tool: string, v: LiveVisit, status: string): void {
    const entry: AuditEntry = {
      at: new Date(this.o.now()).toISOString(),
      tool,
      url: v.url,
      pageType: v.pageType,
      httpStatus: v.httpStatus,
      imported: v.imported,
      status,
    };
    try {
      (this.o.audit ?? ((e) => appendAudit(this.o.config.auditLogPath, e)))(entry);
    } catch {
      /* denetim kaydı hatası gezinmeyi bozmaz */
    }
  }
}
