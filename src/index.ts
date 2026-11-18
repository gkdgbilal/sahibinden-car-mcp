#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { log } from './utils/logger.js';

const server = createServer();
await server.connect(new StdioServerTransport());
log.info('sahibinden-car-mcp started');
