import { describe, expect, it } from 'vitest';
import { loadBrowserConfig } from '../../src/browser/browser-config.js';

const home = '/h/.sahibinden-car-mcp';
const load = (env: Record<string, string>) => loadBrowserConfig(env, home);

describe('loadBrowserConfig', () => {
  it('env boş: kapalı, varsayılan sınırlar ve yollar', () => {
    const c = load({});
    expect(c).toMatchObject({
      enabled: false,
      profileDir: `${home}/chrome-profile`,
      minDelayMs: 5000,
      maxPagesDefault: 3,
      maxPagesHard: 10,
      hourlyCap: 30,
      navTimeoutMs: 30000,
      callDeadlineMs: 180000,
      challengeCooldownMs: 60000,
      statePath: `${home}/browser-state.json`,
      lockPath: `${home}/browser.lock`,
      auditLogPath: `${home}/browser-log.jsonl`,
      warnings: [],
    });
  });

  it.each([['on'], ['ON'], ['1'], ['true'], ['True'], [' on ']])('MODE=%j açar', (v) => {
    expect(load({ SAHIBINDEN_BROWSER_MODE: v }).enabled).toBe(true);
  });
  it.each([['yes'], ['off'], ['0'], ['false'], ['enabled'], ['']])('MODE=%j kapalı kalır', (v) => {
    expect(load({ SAHIBINDEN_BROWSER_MODE: v }).enabled).toBe(false);
  });

  it('gecikme yalnızca artırılabilir', () => {
    const low = load({ SAHIBINDEN_BROWSER_DELAY_MS: '1000' });
    expect(low.minDelayMs).toBe(5000);
    expect(low.warnings.join()).toContain('SAHIBINDEN_BROWSER_DELAY_MS');
    expect(load({ SAHIBINDEN_BROWSER_DELAY_MS: '8000' }).minDelayMs).toBe(8000);
  });

  it('kelepçeler', () => {
    expect(load({ SAHIBINDEN_BROWSER_MAX_PAGES: '50' }).maxPagesDefault).toBe(10);
    expect(load({ SAHIBINDEN_BROWSER_MAX_PAGES: '0' }).maxPagesDefault).toBe(1);
    expect(load({ SAHIBINDEN_BROWSER_HOURLY_CAP: '500' }).hourlyCap).toBe(60);
    expect(load({ SAHIBINDEN_BROWSER_HOURLY_CAP: '0' }).hourlyCap).toBe(1);
    expect(load({ SAHIBINDEN_BROWSER_NAV_TIMEOUT_MS: '100' }).navTimeoutMs).toBe(5000);
    expect(load({ SAHIBINDEN_BROWSER_NAV_TIMEOUT_MS: '999999' }).navTimeoutMs).toBe(60000);
  });

  it('sayı olmayan değer → varsayılan + uyarı', () => {
    const c = load({ SAHIBINDEN_BROWSER_MAX_PAGES: 'abc', SAHIBINDEN_BROWSER_HOURLY_CAP: '-5', SAHIBINDEN_BROWSER_DELAY_MS: '5.5' });
    expect(c.maxPagesDefault).toBe(3);
    expect(c.hourlyCap).toBe(30);
    expect(c.minDelayMs).toBe(5000);
    expect(c.warnings).toHaveLength(3);
  });

  it('profil dizini env ile değişir (mutlak yola çözülür)', () => {
    expect(load({ SAHIBINDEN_BROWSER_PROFILE_DIR: '/tmp/prof' }).profileDir).toBe('/tmp/prof');
  });
});
