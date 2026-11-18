// Bağımlılıksız stdio smoke testi: dist/index.js'i geçici SAHIBINDEN_MCP_HOME ile başlatır ve MCP akışını doğrular.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sahibinden-smoke-'));
const inbox = path.join(home, 'inbox');
fs.mkdirSync(inbox);
for (const f of ['search.synthetic.html', 'listing.synthetic.html']) {
  fs.copyFileSync(path.join(root, 'tests/fixtures', f), path.join(inbox, f));
}

const child = spawn('node', [path.join(root, 'dist/index.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SAHIBINDEN_MCP_HOME: home },
});

const pending = new Map();
let buf = '';
let nextId = 1;

function finish(code, text) {
  clearTimeout(timer);
  console.log(text);
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(code);
}
const fail = (m) => finish(1, `SMOKE FAIL: ${m}`);
const timer = setTimeout(() => fail('timeout (15s)'), 15000);

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return fail(`stdout'ta JSON olmayan satır: ${line.slice(0, 80)}`);
    }
    if (msg.id !== undefined) pending.get(msg.id)?.(msg);
  }
});
child.on('error', (e) => fail(e.message));
child.stderr.on('data', () => {});

const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
const call = (name, args) => request('tools/call', { name, arguments: args });
const assert = (cond, msg) => { if (!cond) fail(msg); };

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' },
  });
  assert(init.result, 'initialize yanıtı yok');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const list = await request('tools/list');
  const tools = list.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  const expected = ['compare_cars', 'get_listing', 'import_listing_html', 'ping', 'search_cars'];
  assert(JSON.stringify(names) === JSON.stringify(expected), `tool listesi beklenenden farklı: ${names}`);
  for (const t of tools) assert(t.inputSchema && t.outputSchema, `${t.name}: input/output şeması eksik`);

  const ping = await call('ping', { msg: 'hi' });
  assert(ping.result?.structuredContent?.pong === 'hi', 'pong != hi');
  assert(ping.result.structuredContent.inboxDir === inbox, 'ping inboxDir geçici dizin değil');

  const imp = await call('import_listing_html', { path: path.join(inbox, 'search.synthetic.html') });
  assert(imp.result?.structuredContent?.imported?.[0]?.count === 3, 'import count != 3');
  const impListing = await call('import_listing_html', { path: 'listing.synthetic.html' });
  assert(impListing.result?.structuredContent?.imported?.[0]?.pageType === 'listing', 'listing import başarısız');

  const outside = await call('import_listing_html', { path: path.join(root, 'tests/fixtures/search.synthetic.html') });
  assert(outside.result?.isError === true || outside.error, 'inbox dışı path reddedilmedi');

  const search = await call('search_cars', {});
  assert(search.result?.structuredContent?.results?.length === 3, 'search_cars results != 3');
  assert(search.result.structuredContent.searchUrls.length >= 1, 'searchUrls boş');

  const cmp = await call('compare_cars', { refs: ['1000000001', '1000000002', '9999999999'] });
  const cmpOut = cmp.result?.structuredContent;
  assert(cmpOut?.rows?.length === 2 && cmpOut.missing?.[0] === '9999999999', 'compare_cars sonucu beklenenden farklı');

  const get = await call('get_listing', { ref: '1000000001' });
  assert(get.result?.structuredContent?.listing?.id === '1000000001', 'get_listing bulamadı');

  const bad = await call('compare_cars', { refs: ['x'] });
  assert(bad.result?.isError === true || bad.error, 'compare_cars tek ref hata vermedi');

  finish(0, 'SMOKE OK');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
