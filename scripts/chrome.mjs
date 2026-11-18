// Tarayıcı modu için adanmış Chrome profilini KULLANICI başlatır (MCP sunucusu Chrome başlatmaz).
// Kullanım: npm run chrome   |   npm run chrome -- --dry-run
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (f) => path.join(root, 'dist', f);
const dryRun = process.argv.includes('--dry-run');
const exit = (code, msg) => {
  (code === 0 ? console.log : console.error)(msg);
  process.exit(code);
};

if (!fs.existsSync(dist('browser/chrome-launch.js')) || !fs.existsSync(dist('config.js'))) {
  exit(1, 'Önce `npm run build` çalıştırın.');
}
const load = (f) => import(pathToFileURL(dist(f)).href);
const launch = await load('browser/chrome-launch.js');
const discovery = await load('browser/discovery.js');
const { browserConfig } = await load('config.js');

const env = { platform: process.platform, env: process.env, homedir: os.homedir() };
const profileDir = browserConfig.profileDir;

try {
  launch.assertNotDefaultProfile(profileDir, { ...env, exists: fs.existsSync, realpath: fs.realpathSync });
} catch (err) {
  exit(1, `Hata: ${err.message}`);
}

if (discovery.readDevToolsActivePort(profileDir)) {
  try {
    const client = await discovery.connectToProfile(profileDir);
    client.close();
    exit(0, `Adanmış Chrome zaten açık (profil: ${profileDir}).`);
  } catch {
    // Bayat DevToolsActivePort dosyası: Chrome kapalı, yeniden başlat.
  }
}

const chrome = launch.findChrome({ ...env, exists: fs.existsSync });
if (!chrome) {
  const tried = launch.chromeCandidatePaths(env).map((c) => `  - ${c}`).join('\n');
  exit(
    1,
    `Chrome/Chromium bulunamadı. Aranan yollar:\n${tried}\nKurulu Chrome'un tam yolunu SAHIBINDEN_CHROME_PATH ile verin.`,
  );
}

const args = launch.buildChromeArgs(profileDir);
if (dryRun) {
  exit(0, `[dry-run] Chrome başlatılmadı.\nChrome: ${chrome}\nArgümanlar:\n${args.map((a) => `  ${a}`).join('\n')}`);
}

fs.mkdirSync(profileDir, { recursive: true });
const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
child.on('error', (err) => exit(1, `Chrome başlatılamadı: ${err.message}`));
child.unref();

console.log(`Adanmış Chrome başlatıldı (profil: ${profileDir}).

Önemli:
- Tarayıcı modu otomatik erişim sayılabilir ve sahibinden.com kullanım koşullarına aykırı kabul edilebilir;
  erişiminiz veya hesabınız kısıtlanabilir. Sorumluluk size aittir.
- Bu pencerede sahibinden hesabınıza GİRİŞ YAPMAYIN ve bu profili başka sitelerde kullanmayın; anonim gezilir.
- Hata ayıklama portu açıkken bilgisayarınızdaki diğer programlar da bu profili kontrol edebilir;
  işiniz bitince bu Chrome penceresini kapatın.

Bu pencerede sahibinden.com'u bir kez kendiniz açın; doğrulama (Cloudflare) çıkarsa kendiniz geçin.`);
setTimeout(() => process.exit(0), 300);
