import path from 'node:path';

export interface BrowserConfig {
  enabled: boolean;
  profileDir: string;
  minDelayMs: number;
  maxPagesDefault: number;
  maxPagesHard: 10;
  hourlyCap: number;
  navTimeoutMs: number;
  callDeadlineMs: number;
  challengeCooldownMs: number;
  statePath: string;
  lockPath: string;
  auditLogPath: string;
  warnings: string[];
}

const MIN_DELAY_MS = 5000;

function intEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  def: number,
  min: number,
  max: number,
  warnings: string[],
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return def;
  if (!/^\d{1,9}$/.test(raw)) {
    warnings.push(`${name}="${raw}" sayı değil; varsayılan ${def} kullanıldı.`);
    return def;
  }
  const n = Number(raw);
  const clamped = Math.min(max, Math.max(min, n));
  if (clamped !== n) warnings.push(`${name}=${n} izinli aralığın (${min}..${max}) dışında; ${clamped} kullanıldı.`);
  return clamped;
}

/** Tarayıcı modu ayarları (saf). Varsayılan KAPALI; yalnızca on/1/true açar. Sınırlar kelepçelenir. */
export function loadBrowserConfig(env: NodeJS.ProcessEnv, homeDir: string): BrowserConfig {
  const warnings: string[] = [];
  const enabled = /^(on|1|true)$/i.test(env.SAHIBINDEN_BROWSER_MODE?.trim() ?? '');
  const profileRaw = env.SAHIBINDEN_BROWSER_PROFILE_DIR?.trim();
  return {
    enabled,
    profileDir: profileRaw ? path.resolve(profileRaw) : path.join(homeDir, 'chrome-profile'),
    // Gecikme yalnızca artırılabilir (üst sınır yalnızca makul bir taşma koruması).
    minDelayMs: intEnv(env, 'SAHIBINDEN_BROWSER_DELAY_MS', MIN_DELAY_MS, MIN_DELAY_MS, 600_000, warnings),
    maxPagesDefault: intEnv(env, 'SAHIBINDEN_BROWSER_MAX_PAGES', 3, 1, 10, warnings),
    maxPagesHard: 10,
    hourlyCap: intEnv(env, 'SAHIBINDEN_BROWSER_HOURLY_CAP', 30, 1, 60, warnings),
    navTimeoutMs: intEnv(env, 'SAHIBINDEN_BROWSER_NAV_TIMEOUT_MS', 30_000, 5000, 60_000, warnings),
    callDeadlineMs: 180_000,
    challengeCooldownMs: 60_000,
    statePath: path.join(homeDir, 'browser-state.json'),
    lockPath: path.join(homeDir, 'browser.lock'),
    auditLogPath: path.join(homeDir, 'browser-log.jsonl'),
    warnings,
  };
}
