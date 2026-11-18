import { McpServer } from '@modelcontextprotocol/server';
import { VERSION } from './config.js';
import { log } from './utils/logger.js';
import type { ToolDeps } from './tools/deps.js';
import { PING_DESCRIPTION, pingHandler, pingInput, pingOutput } from './tools/ping.js';
import {
  SEARCH_CARS_DESCRIPTION, searchCarsHandler, searchCarsInput, searchCarsOutput,
} from './tools/search-cars.js';
import {
  GET_LISTING_DESCRIPTION, getListingHandler, getListingInput, getListingOutput,
} from './tools/get-listing.js';
import {
  COMPARE_CARS_DESCRIPTION, compareCarsHandler, compareCarsInput, compareCarsOutput,
} from './tools/compare-cars.js';
import {
  IMPORT_LISTING_HTML_DESCRIPTION, importListingHtmlHandler, importListingHtmlInput, importListingHtmlOutput,
} from './tools/import-listing-html.js';
import {
  BROWSER_STATUS_DESCRIPTION, browserStatusHandler, browserStatusInput, browserStatusOutput,
} from './tools/browser-status.js';
import {
  LIVE_SEARCH_DESCRIPTION, liveSearchHandler, liveSearchInput, liveSearchOutput,
} from './tools/live-search.js';
import {
  LIVE_GET_LISTINGS_DESCRIPTION, liveGetListingsHandler, liveGetListingsInput, liveGetListingsOutput,
} from './tools/live-get-listings.js';

export function ok<T extends object>(out: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(out) }], structuredContent: out };
}

export function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

/** Handler hatasını isError sonucuna çevirir; ayrıntı stderr'e, stdout'a hiçbir şey yazılmaz. */
async function run<T extends object>(tool: string, fn: () => Promise<T>) {
  try {
    return ok(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`${tool} failed`, { message });
    return fail(message);
  }
}

export function createServer(deps: ToolDeps) {
  const server = new McpServer({ name: 'sahibinden-car-mcp', version: VERSION });

  server.registerTool(
    'ping',
    { title: 'Ping', description: PING_DESCRIPTION, inputSchema: pingInput, outputSchema: pingOutput },
    (args) => run('ping', () => pingHandler(args, deps)),
  );
  server.registerTool(
    'search_cars',
    { title: 'Araç ara', description: SEARCH_CARS_DESCRIPTION, inputSchema: searchCarsInput, outputSchema: searchCarsOutput },
    (args) => run('search_cars', () => searchCarsHandler(args, deps)),
  );
  server.registerTool(
    'get_listing',
    { title: 'İlan detayı', description: GET_LISTING_DESCRIPTION, inputSchema: getListingInput, outputSchema: getListingOutput },
    (args) => run('get_listing', () => getListingHandler(args, deps)),
  );
  server.registerTool(
    'compare_cars',
    { title: 'İlanları karşılaştır', description: COMPARE_CARS_DESCRIPTION, inputSchema: compareCarsInput, outputSchema: compareCarsOutput },
    (args) => run('compare_cars', () => compareCarsHandler(args, deps)),
  );
  server.registerTool(
    'import_listing_html',
    {
      title: 'İlan HTML içe aktar',
      description: IMPORT_LISTING_HTML_DESCRIPTION,
      inputSchema: importListingHtmlInput,
      outputSchema: importListingHtmlOutput,
    },
    (args) => run('import_listing_html', () => importListingHtmlHandler(args, deps)),
  );

  // Tarayıcı modu (varsayılan KAPALI): yalnızca deps.live verilmişse kaydedilir; aksi halde tool listesi 5 tool'dur.
  if (deps.live) {
    server.registerTool(
      'browser_status',
      { title: 'Tarayıcı durumu', description: BROWSER_STATUS_DESCRIPTION, inputSchema: browserStatusInput, outputSchema: browserStatusOutput },
      (args) => run('browser_status', () => browserStatusHandler(args, deps)),
    );
    server.registerTool(
      'live_search',
      { title: 'Canlı arama (tarayıcı)', description: LIVE_SEARCH_DESCRIPTION, inputSchema: liveSearchInput, outputSchema: liveSearchOutput },
      (args) => run('live_search', () => liveSearchHandler(args, deps)),
    );
    server.registerTool(
      'live_get_listings',
      {
        title: 'Canlı ilan detayı (tarayıcı)',
        description: LIVE_GET_LISTINGS_DESCRIPTION,
        inputSchema: liveGetListingsInput,
        outputSchema: liveGetListingsOutput,
      },
      (args) => run('live_get_listings', () => liveGetListingsHandler(args, deps)),
    );
  }

  return server;
}
