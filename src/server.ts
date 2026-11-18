import { McpServer } from '@modelcontextprotocol/server';
import { VERSION } from './config.js';
import { log } from './utils/logger.js';
import { pingHandler, pingInput, pingOutput } from './tools/ping.js';

export function ok<T extends object>(out: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(out) }], structuredContent: out };
}

export function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export function createServer() {
  const server = new McpServer({ name: 'sahibinden-car-mcp', version: VERSION });

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Sağlık kontrolü.',
      inputSchema: pingInput,
      outputSchema: pingOutput,
    },
    async (args) => {
      try {
        return ok(pingHandler(args));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('ping failed', { message });
        return fail(message);
      }
    },
  );

  return server;
}
