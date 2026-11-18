import path from 'node:path';

export interface LaunchEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  exists: (p: string) => boolean;
  /** Sembolik bağları çözmek için (yoksa yol olduğu gibi kullanılır). */
  realpath?: (p: string) => string;
}

const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

/** Kullanıcının kurulu Chrome/Chromium yolu; bulunamazsa null. SAHIBINDEN_CHROME_PATH öncelikli ve var olmalı. */
export function findChrome(o: LaunchEnv): string | null {
  const p = pathFor(o.platform);
  const override = o.env.SAHIBINDEN_CHROME_PATH?.trim();
  if (override) return o.exists(override) ? override : null;

  let candidates: string[] = [];
  if (o.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      p.join(o.homedir, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  } else if (o.platform === 'win32') {
    const rel = p.join('Google', 'Chrome', 'Application', 'chrome.exe');
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']) {
      const base = o.env[key];
      if (base) candidates.push(p.join(base, rel));
    }
  } else {
    const dirs = (o.env.PATH ?? '').split(':').filter(Boolean);
    for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
      for (const d of dirs) candidates.push(p.join(d, name));
    }
  }
  return candidates.find((c) => o.exists(c)) ?? null;
}

/** Aranan yolların listesi (bulunamadı mesajı için). */
export function chromeCandidatePaths(o: Omit<LaunchEnv, 'exists'>): string[] {
  const seen: string[] = [];
  findChrome({ ...o, exists: (c) => (seen.push(c), false), env: { ...o.env, SAHIBINDEN_CHROME_PATH: undefined } });
  return seen;
}

/** Chrome'un varsayılan kullanıcı veri dizinleri (adanmış profil bunların içinde olamaz). */
export function defaultChromeDataDirs(o: Pick<LaunchEnv, 'platform' | 'env' | 'homedir'>): string[] {
  const p = pathFor(o.platform);
  if (o.platform === 'darwin') return [p.join(o.homedir, 'Library/Application Support/Google/Chrome')];
  if (o.platform === 'win32') {
    const local = o.env.LOCALAPPDATA ?? p.join(o.homedir, 'AppData', 'Local');
    return [p.join(local, 'Google', 'Chrome', 'User Data')];
  }
  return [p.join(o.homedir, '.config/google-chrome'), p.join(o.homedir, '.config/chromium')];
}

/** Profil yolu varsayılan Chrome veri dizinine eşitse ya da onun altındaysa hata fırlatır. */
export function assertNotDefaultProfile(profileDir: string, o: LaunchEnv): void {
  const p = pathFor(o.platform);
  const fold = (s: string) => (o.platform === 'linux' ? s : s.toLowerCase());
  const real = (s: string) => {
    const r = p.resolve(s);
    try {
      return o.realpath ? o.realpath(r) : r;
    } catch {
      return r;
    }
  };
  const target = fold(real(profileDir));
  for (const dir of defaultChromeDataDirs(o)) {
    const root = fold(real(dir));
    const rel = p.relative(root, target);
    if (rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel))) {
      throw new Error(
        `Profil yolu Chrome'un varsayılan veri dizini (${dir}) içinde olamaz; adanmış ayrı bir dizin kullanın.`,
      );
    }
  }
}

/** Başlatıcının Chrome'a verdiği TAM argüman listesi; başka bayrak yoktur. */
export function buildChromeArgs(profileDir: string): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ];
}
