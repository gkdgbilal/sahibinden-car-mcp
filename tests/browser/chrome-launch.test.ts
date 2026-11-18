import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNotDefaultProfile, buildChromeArgs, chromeCandidatePaths, defaultChromeDataDirs, findChrome,
} from '../../src/browser/chrome-launch.js';

const mac = { platform: 'darwin' as const, env: {}, homedir: '/Users/test' };
const existsOnly = (...paths: string[]) => (p: string) => paths.includes(p);

describe('findChrome', () => {
  it('darwin: sistem Chrome, sonra kullanıcı Applications, sonra Chromium', () => {
    const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const usr = '/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const chromium = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    expect(findChrome({ ...mac, exists: existsOnly(sys, usr, chromium) })).toBe(sys);
    expect(findChrome({ ...mac, exists: existsOnly(usr, chromium) })).toBe(usr);
    expect(findChrome({ ...mac, exists: existsOnly(chromium) })).toBe(chromium);
    expect(findChrome({ ...mac, exists: existsOnly() })).toBeNull();
  });

  it('linux: PATH taranır, ad sırası google-chrome-stable > google-chrome > chromium > chromium-browser', () => {
    const o = { platform: 'linux' as const, env: { PATH: '/usr/local/bin:/usr/bin' }, homedir: '/home/t' };
    expect(findChrome({ ...o, exists: existsOnly('/usr/bin/chromium', '/usr/local/bin/google-chrome') })).toBe(
      '/usr/local/bin/google-chrome',
    );
    expect(findChrome({ ...o, exists: existsOnly('/usr/bin/chromium-browser') })).toBe('/usr/bin/chromium-browser');
    expect(findChrome({ ...o, exists: existsOnly() })).toBeNull();
  });

  it('win32: ProgramFiles, ProgramFiles(x86), LOCALAPPDATA', () => {
    const env = {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local',
    };
    const o = { platform: 'win32' as const, env, homedir: 'C:\\Users\\t' };
    const rel = '\\Google\\Chrome\\Application\\chrome.exe';
    expect(findChrome({ ...o, exists: existsOnly(`C:\\Program Files (x86)${rel}`, `C:\\Users\\t\\AppData\\Local${rel}`) })).toBe(
      `C:\\Program Files (x86)${rel}`,
    );
    expect(findChrome({ ...o, exists: existsOnly(`C:\\Users\\t\\AppData\\Local${rel}`) })).toBe(`C:\\Users\\t\\AppData\\Local${rel}`);
  });

  it('SAHIBINDEN_CHROME_PATH önce gelir; yoksa null (sessizce başka Chrome seçilmez)', () => {
    const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const env = { SAHIBINDEN_CHROME_PATH: '/opt/my-chrome' };
    expect(findChrome({ ...mac, env, exists: existsOnly('/opt/my-chrome', sys) })).toBe('/opt/my-chrome');
    expect(findChrome({ ...mac, env, exists: existsOnly(sys) })).toBeNull();
  });

  it('chromeCandidatePaths denenecek yolları listeler', () => {
    expect(chromeCandidatePaths(mac)).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });
});

describe('buildChromeArgs', () => {
  it('argüman listesi TAM eşitlik', () => {
    expect(buildChromeArgs('/p/chrome-profile')).toEqual([
      '--user-data-dir=/p/chrome-profile',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ]);
  });

  it('gizleme/ortam taklidi/yük bayraklarından hiçbiri yok', () => {
    const banned = [
      'enable-automation', 'AutomationControlled', 'headless', 'user-agent', 'proxy-server', 'disable-web-security',
      'load-extension', 'remote-allow-origins', 'remote-debugging-address', 'remote-debugging-pipe', 'incognito',
      'lang', 'window-size',
    ];
    const joined = buildChromeArgs('/p/x').join(' ');
    for (const b of banned) expect(joined).not.toContain(b);
  });
});

describe('assertNotDefaultProfile', () => {
  it('varsayılan veri dizini listeleri', () => {
    expect(defaultChromeDataDirs(mac)).toEqual(['/Users/test/Library/Application Support/Google/Chrome']);
    expect(defaultChromeDataDirs({ platform: 'linux', env: {}, homedir: '/home/t' })).toEqual([
      '/home/t/.config/google-chrome',
      '/home/t/.config/chromium',
    ]);
    expect(
      defaultChromeDataDirs({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' }, homedir: 'C:\\Users\\t' }),
    ).toEqual(['C:\\Users\\t\\AppData\\Local\\Google\\Chrome\\User Data']);
  });

  const o = { ...mac, exists: () => true };
  it('varsayılan dizin ve altındakiler reddedilir', () => {
    const def = '/Users/test/Library/Application Support/Google/Chrome';
    expect(() => assertNotDefaultProfile(def, o)).toThrow(/varsayılan/);
    expect(() => assertNotDefaultProfile(`${def}/Default`, o)).toThrow();
    expect(() => assertNotDefaultProfile(`${def}/../Chrome/x`, o)).toThrow();
    expect(() => assertNotDefaultProfile(def.toLowerCase(), o)).toThrow(); // macOS büyük/küçük harf duyarsız
  });
  it('linux varsayılan dizinleri ve win32 reddedilir', () => {
    const l = { platform: 'linux' as const, env: {}, homedir: '/home/t', exists: () => true };
    expect(() => assertNotDefaultProfile('/home/t/.config/chromium/Default', l)).toThrow();
    const w = { platform: 'win32' as const, env: { LOCALAPPDATA: 'C:\\U\\Local' }, homedir: 'C:\\U', exists: () => true };
    expect(() => assertNotDefaultProfile('c:\\u\\local\\google\\chrome\\user data', w)).toThrow();
  });
  it('adanmış profil kabul edilir', () => {
    expect(() => assertNotDefaultProfile('/Users/test/.sahibinden-car-mcp/chrome-profile', o)).not.toThrow();
    expect(() => assertNotDefaultProfile('/Users/test/Library/Application Support/Google/Chrome-sahibinden', o)).not.toThrow();
  });
  it('sembolik bağ çözümü varsayılan dizine çıkıyorsa reddedilir', () => {
    const real = (p: string) => (p === path.resolve('/tmp/link') ? '/Users/test/Library/Application Support/Google/Chrome' : p);
    expect(() => assertNotDefaultProfile('/tmp/link', { ...o, realpath: real })).toThrow();
  });
});
