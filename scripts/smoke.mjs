// Bağımlılıksız stdio smoke testi: dist/index.js'i başlatır ve MCP akışını doğrular.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn('node', [path.join(root, 'dist/index.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

const msgs = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ping', arguments: { msg: 'hi' } } },
];

const responses = new Map();
let buf = '';
let failed = null;

function finish(code, text) {
  clearTimeout(timer);
  console.log(text);
  child.kill();
  process.exit(code);
}

const timer = setTimeout(() => finish(1, 'SMOKE FAIL: timeout (5s)'), 5000);

function check() {
  const list = responses.get(2);
  const call = responses.get(3);
  if (!list || !call) return;
  const tools = list.result?.tools ?? [];
  if (!tools.some((t) => t.name === 'ping')) return finish(1, 'SMOKE FAIL: ping tool yok');
  if (call.result?.structuredContent?.pong !== 'hi') return finish(1, 'SMOKE FAIL: pong != hi');
  finish(0, 'SMOKE OK');
}

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch {
      failed = `stdout'ta JSON olmayan satır: ${line.slice(0, 80)}`;
      return finish(1, `SMOKE FAIL: ${failed}`);
    }
  }
  check();
});
child.on('error', (e) => finish(1, `SMOKE FAIL: ${e.message}`));
child.stderr.on('data', () => {});

for (const m of msgs) child.stdin.write(JSON.stringify(m) + '\n');
