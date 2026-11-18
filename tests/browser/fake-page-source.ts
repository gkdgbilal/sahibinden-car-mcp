import { BrowserError } from '../../src/browser/errors.js';
import type { BrowserSession, NavResult, PageSource, Tab } from '../../src/browser/page-source.js';

export interface Step {
  html: string;
  nav?: Partial<NavResult>;
}

/** Senaryolu sahte sayfa kaynağı: gerçek Chrome/ağ yok. */
export class FakePageSource implements PageSource {
  navigateCalls: string[] = [];
  openedTabs: string[] = [];
  closedTabs: string[] = [];
  connectCalls = 0;
  sessionsClosed = 0;
  connectError: Error | null = null;
  /** attachTab davranışı: 'missing' → null; 'challenge' → hâlâ doğrulama; 'ready' → doğrulama geçilmiş. */
  attachBehavior: 'missing' | 'challenge' | 'ready' = 'missing';
  steps: Step[] = [];
  stepFn: ((url: string, n: number) => Step) | null = null;
  private seq = 0;

  async connect(): Promise<BrowserSession> {
    this.connectCalls++;
    if (this.connectError) throw this.connectError;
    return {
      version: async () => 'Chrome/999.0.0.0',
      openTab: async () => this.makeTab(`T${++this.seq}`, true),
      attachTab: async (targetId) => (this.attachBehavior === 'missing' ? null : this.makeTab(targetId, false)),
      close: async () => void this.sessionsClosed++,
    };
  }

  private makeTab(targetId: string, own: boolean): Tab {
    if (own) this.openedTabs.push(targetId);
    let html = '';
    return {
      targetId,
      navigate: async (url) => {
        this.navigateCalls.push(url);
        const step = this.stepFn ? this.stepFn(url, this.navigateCalls.length - 1) : this.steps.shift();
        if (!step) throw new BrowserError('timeout', 'sahte kaynak: senaryo adımı kalmadı');
        html = step.html;
        return {
          finalUrl: url,
          httpStatus: 200,
          cfMitigated: false,
          errorText: null,
          quickKind: 'ready',
          ...step.nav,
        };
      },
      html: async () => html,
      currentKind: async () => (this.attachBehavior === 'challenge' ? 'challenge' : 'ready'),
      close: async () => void this.closedTabs.push(targetId),
    };
  }
}
