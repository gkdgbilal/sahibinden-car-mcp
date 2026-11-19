#!/usr/bin/env node
import fs from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import path from 'node:path';
import { browserConfig, homeDir, inboxDir, storePath } from './config.js';
import { CdpPageSource } from './browser/cdp-page-source.js';
import { RateLimiter } from './browser/rate-limiter.js';
import { BrowserProvider } from './providers/browser-provider.js';
import { ImportProvider } from './providers/import-provider.js';
import { catalog } from './sahibinden/catalog.js';
import { CatalogLearner } from './sahibinden/catalog-learn.js';
import { createServer } from './server.js';
import { JsonStore } from './store/json-store.js';
import { log } from './utils/logger.js';

const store = new JsonStore(storePath);
// Katalog: pakete gömülü (siteden toplanmış) + kullanıcının içe aktardığı arama sayfalarından öğrenilen motor yolları.
const learner = new CatalogLearner(catalog, path.join(homeDir, 'catalog-learned.json'));
learner.load();
const provider = new ImportProvider({
  store,
  learner,
  inboxDir,
  now: () => new Date().toISOString(),
  // Yakalama zamanı = sayfanın dosyaya kaydedildiği an (mtime); ImportProvider now ile kırpar.
  fileTime: (f) => fs.statSync(f).mtime,
});

// Tarayıcı modu varsayılan KAPALI; yalnızca SAHIBINDEN_BROWSER_MODE=on iken canlı tool'lar kaydedilir.
// Başlangıçta Chrome'a bağlanılmaz (yalnızca bir tool çağrısında).
for (const w of browserConfig.warnings) log.warn(w);
const live = browserConfig.enabled
  ? new BrowserProvider({
      config: browserConfig,
      importProvider: provider,
      store,
      source: new CdpPageSource({ profileDir: browserConfig.profileDir }),
      limiter: new RateLimiter({
        statePath: browserConfig.statePath,
        minDelayMs: browserConfig.minDelayMs,
        hourlyCap: browserConfig.hourlyCap,
        challengeCooldownMs: browserConfig.challengeCooldownMs,
        now: Date.now,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      }),
      now: Date.now,
    })
  : undefined;

const server = createServer({
  provider,
  nowYear: () => new Date().getFullYear(),
  store,
  now: () => new Date(),
  ...(live ? { live } : {}),
});
await server.connect(new StdioServerTransport());
log.info('sahibinden-car-mcp started', {
  provider: provider.name,
  inboxDir,
  browserMode: live ? 'enabled' : 'disabled',
});
