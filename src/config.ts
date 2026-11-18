import os from 'node:os';
import path from 'node:path';

export const VERSION = '0.1.1';

export const homeDir =
  process.env.SAHIBINDEN_MCP_HOME ?? path.join(os.homedir(), '.sahibinden-car-mcp');
export const inboxDir = path.join(homeDir, 'inbox');
export const storePath = path.join(homeDir, 'store.json');

export const MAX_FILE_BYTES = 10_000_000;
export const MAX_HTML_ARG = 5_000_000;
export const DESCRIPTION_MAX = 4000;
