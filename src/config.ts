import os from 'node:os';
import path from 'node:path';
import { loadBrowserConfig } from './browser/browser-config.js';

export const VERSION = '0.2.0';

/**
 * Parser davranışı değişince artırılır. Kayıtlı parserVersion bundan eskiyse (sürümsüz = 1)
 * aynı içerikli dosya yeniden parse edilir. 2: tramer çıkarımı (tramerRecords/tramerStatus).
 * 3: arama sayfası pageUrls (arama bağlamı).
 */
export const PARSER_VERSION = 3;

export const homeDir =
  process.env.SAHIBINDEN_MCP_HOME ?? path.join(os.homedir(), '.sahibinden-car-mcp');
export const inboxDir = path.join(homeDir, 'inbox');
export const storePath = path.join(homeDir, 'store.json');

export const MAX_FILE_BYTES = 10_000_000;
export const MAX_HTML_ARG = 5_000_000;
export const DESCRIPTION_MAX = 4000;

/** Tarayıcı modu ayarları (varsayılan KAPALI). */
export const browserConfig = loadBrowserConfig(process.env, homeDir);
