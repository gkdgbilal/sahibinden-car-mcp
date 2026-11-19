import { CdpClient } from './cdp-client.js';
import { connectToProfile } from './discovery.js';
import { BrowserError } from './errors.js';
import type { BrowserSession, NavResult, PageSource, Tab } from './page-source.js';

/**
 * Sayfada çalıştırılan TÜM ifadeler bu modüldeki sabitlerdir; modül dışından (model/kullanıcı) ifade kabul edilmez.
 * Hepsi salt-okumadır (DOM sorgusu); ağ isteği başlatmaz.
 */
const QUICK_KIND_EXPR = `(() => {
  const t = (document.title || '').toLowerCase();
  if (t.includes('just a moment') || t.includes('bir dakika') || /^\\s*2 a[şs]amal[ıi] do[ğg]rulama/.test(t) ||
      document.querySelector('#challenge-form, .cf-turnstile, script[src*="/cdn-cgi/challenge-platform/"]')) return 'challenge';
  if (document.querySelector('tr.searchResultsItem[data-id], #searchResultsTable, .classifiedInfoList')) return 'ready';
  return document.readyState === 'complete' ? 'complete' : 'loading';
})()`;
const HTML_EXPR = 'document.documentElement.outerHTML';
const HREF_EXPR = 'location.href';

export interface CdpPageSourceOptions {
  profileDir: string;
  connect?: (profileDir: string) => Promise<CdpClient>;
  /** Sabit yoklama aralığı (varsayılan 500 ms). */
  pollMs?: number;
  /** Hazır işareti yokken sayfa "complete" olduktan sonra beklenecek sabit süre (varsayılan 2000 ms). */
  settleMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Timing {
  pollMs: number;
  settleMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export class CdpPageSource implements PageSource {
  private readonly timing: Timing;
  constructor(private readonly o: CdpPageSourceOptions) {
    this.timing = {
      pollMs: o.pollMs ?? 500,
      settleMs: o.settleMs ?? 2000,
      now: o.now ?? Date.now,
      sleep: o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    };
  }

  async connect(): Promise<BrowserSession> {
    const client = await (this.o.connect ?? connectToProfile)(this.o.profileDir);
    return new CdpSession(client, this.timing);
  }
}

class CdpSession implements BrowserSession {
  constructor(private readonly client: CdpClient, private readonly timing: Timing) {}

  async version(): Promise<string> {
    const r = await this.client.send<{ product?: string }>('Browser.getVersion');
    return r.product ?? 'unknown';
  }

  async openTab(): Promise<Tab> {
    const { targetId } = await this.client.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.client.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    await this.client.send('Page.enable', {}, sessionId);
    await this.client.send('Network.enable', {}, sessionId);
    return new CdpTab(this.client, targetId, sessionId, this.timing);
  }

  async attachTab(targetId: string): Promise<Tab | null> {
    try {
      await this.client.send('Target.getTargetInfo', { targetId });
    } catch (err) {
      if (err instanceof BrowserError) throw err; // bağlantı sorunu: sekme yok demek değildir
      return null;
    }
    const { sessionId } = await this.client.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    return new CdpTab(this.client, targetId, sessionId, this.timing);
  }

  async close(): Promise<void> {
    this.client.close();
  }
}

interface DocResponse {
  frameId: string | undefined;
  status: number;
  cfMitigated: boolean;
}

class CdpTab implements Tab {
  constructor(
    private readonly client: CdpClient,
    readonly targetId: string,
    private readonly sessionId: string,
    private readonly timing: Timing,
  ) {}

  private async evalString(expression: string): Promise<string | null> {
    const r = await this.client.send<{ result?: { value?: unknown }; exceptionDetails?: unknown }>(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      this.sessionId,
    );
    if (r.exceptionDetails) return null;
    return typeof r.result?.value === 'string' ? r.result.value : null;
  }

  async navigate(url: string, timeoutMs: number): Promise<NavResult> {
    const docs: DocResponse[] = [];
    const off = this.client.on('Network.responseReceived', (p, sid) => {
      if (sid !== this.sessionId || p?.type !== 'Document') return;
      const headers = (p.response?.headers ?? {}) as Record<string, unknown>;
      const cf = Object.keys(headers).some((k) => k.toLowerCase() === 'cf-mitigated');
      docs.push({ frameId: p.frameId, status: Number(p.response?.status ?? 0), cfMitigated: cf });
    });
    const loaded = this.client.waitFor('Page.loadEventFired', (_p, sid) => sid === this.sessionId, timeoutMs);
    loaded.catch(() => undefined); // erken çıkışta işlenmemiş reddi önle

    try {
      const nav = await this.client.send<{ frameId?: string; errorText?: string }>(
        'Page.navigate',
        { url },
        this.sessionId,
      );
      const finish = async (quickKind: NavResult['quickKind']): Promise<NavResult> => {
        const mine = nav.frameId ? docs.filter((d) => d.frameId === nav.frameId) : docs;
        const main = mine[mine.length - 1] ?? docs[docs.length - 1];
        return {
          finalUrl: await this.evalString(HREF_EXPR).catch(() => null),
          httpStatus: main ? main.status : null,
          cfMitigated: main?.cfMitigated ?? false,
          errorText: null,
          quickKind,
        };
      };
      if (nav.errorText) {
        return { finalUrl: null, httpStatus: null, cfMitigated: false, errorText: nav.errorText, quickKind: 'timeout' };
      }

      const start = this.timing.now();
      let loadedInTime = true;
      try {
        await loaded;
      } catch (err) {
        if (!(err instanceof BrowserError) || err.code !== 'timeout') throw err;
        loadedInTime = false;
      }

      let completeSince: number | null = null;
      for (;;) {
        const kind = await this.evalString(QUICK_KIND_EXPR);
        if (kind === 'challenge') return finish('challenge');
        if (kind === 'ready') return finish('ready');
        const t = this.timing.now();
        if (kind === 'complete') {
          completeSince ??= t;
          if (t - completeSince >= this.timing.settleMs) return finish('ready');
        } else {
          completeSince = null;
        }
        if (!loadedInTime || t - start >= timeoutMs) return finish('timeout');
        await this.timing.sleep(this.timing.pollMs);
      }
    } finally {
      off();
    }
  }

  async html(): Promise<string> {
    return (await this.evalString(HTML_EXPR)) ?? '';
  }

  async currentKind(): Promise<'ready' | 'challenge' | 'other'> {
    const kind = await this.evalString(QUICK_KIND_EXPR);
    return kind === 'challenge' ? 'challenge' : kind === 'ready' ? 'ready' : 'other';
  }

  async close(): Promise<void> {
    await this.client.send('Target.closeTarget', { targetId: this.targetId });
  }
}
