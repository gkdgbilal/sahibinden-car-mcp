#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { inboxDir, storePath } from './config.js';
import { ImportProvider } from './providers/import-provider.js';
import { createServer } from './server.js';
import { JsonStore } from './store/json-store.js';
import { log } from './utils/logger.js';

const provider = new ImportProvider({
  store: new JsonStore(storePath),
  inboxDir,
  now: () => new Date().toISOString(),
});
const server = createServer({ provider, nowYear: () => new Date().getFullYear() });
await server.connect(new StdioServerTransport());
log.info('sahibinden-car-mcp started', { provider: provider.name, inboxDir });
