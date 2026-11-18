// Bağımlılıksız demo üretici: dist/index.js'i stdio'dan başlatır, uydurma fixture'larla gerçek tool çağrıları yapar
// ve çıktıyı docs/assets/demo.svg olarak yazar. Kullanım: npm run build && npm run demo
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist/index.js');
if (!fs.existsSync(entry)) {
  console.error('dist/index.js bulunamadı. Önce `npm run build` çalıştırın, sonra `npm run demo`.');
  process.exit(1);
}

const FIXTURES = ['real-shape.search.html', 'real-shape.search-city.html', 'real-shape.listing.html'];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sahibinden-demo-'));
const inbox = path.join(home, 'inbox');
fs.mkdirSync(inbox);
for (const f of FIXTURES) fs.copyFileSync(path.join(root, 'tests/fixtures', f), path.join(inbox, f));

const child = spawn('node', [entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SAHIBINDEN_MCP_HOME: home },
});
const cleanup = () => {
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
};
const die = (msg) => {
  cleanup();
  console.error(`DEMO FAIL: ${msg}`);
  process.exit(1);
};
const timer = setTimeout(() => die('timeout (20s)'), 20000);

const pending = new Map();
let buf = '';
let nextId = 1;
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
      return die('stdout\'ta JSON olmayan satır');
    }
    if (msg.id !== undefined) pending.get(msg.id)?.(msg);
  }
});
child.on('error', (e) => die(e.message));
child.stderr.on('data', () => {});

const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
async function call(name, args) {
  const res = await request('tools/call', { name, arguments: args });
  if (res.error || res.result?.isError || !res.result?.structuredContent) {
    die(`${name} başarısız: ${JSON.stringify(res.error ?? res.result).slice(0, 200)}`);
  }
  return res.result.structuredContent;
}

// ---- Biçimlendirme yardımcıları (hepsi tool çıktısından türetilir) ----
const num = (n) => (n === null || n === undefined ? '-' : Math.round(n).toLocaleString('tr-TR'));
const money = (n, cur) => (n === null ? '-' : `${num(n)} ${cur ?? ''}`.trim());
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const pct = (n) => (n === null ? '-' : `${n > 0 ? '+' : ''}${String(n).replace('.', ',')}%`);

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'render-demo', version: '1' },
  });
  if (!init.result) die('initialize yanıtı yok');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const imported = await call('import_listing_html', {});
  const query = { city: 'Samsun', priceMax: 600000, yearMin: 2009, yearMax: 2012, kmMax: 230000, sort: 'km_asc' };
  const search = await call('search_cars', query);
  const detailId = imported.imported.find((f) => f.pageType === 'listing')?.ids?.[0];
  if (!detailId) die('listing sayfası içe aktarılamadı');
  const refs = [...new Set([detailId, ...search.results.map((r) => r.id)])].slice(0, 3);
  const cmp = await call('compare_cars', { refs });
  // compare_cars para birimi döndürmez; ilgili ilanlardan (search/get_listing çıktısı) alınır.
  const currency = new Map(search.results.map((r) => [r.id, r.currency]));
  if (!currency.has(detailId)) currency.set(detailId, (await call('get_listing', { ref: detailId })).listing.currency);

  // ---- Satırlar: her satır [metin, sınıf] parçalarından oluşur ----
  const L = [];
  const line = (...segs) => L.push(segs);
  const gap = () => L.push([]);
  
  line(['Sample data (synthetic fixtures) — real tool output, nothing hand-written', 'warn']);
  gap();
  line(['$ ', 'prompt'], ['import_listing_html', 'cmd']);
  for (const f of imported.imported) {
    line(['  ', 'dim'], [pad(path.basename(f.file), 30), 'txt'], [pad(f.pageType, 9), 'dim'], [`${f.count} listing${f.count === 1 ? '' : 's'}`, 'txt']);
  }
  line(['  ', 'dim'], [`skipped: ${imported.skipped.length}   store size: ${imported.storeSize}`, 'dim']);
  gap();

  // Uzun argüman satırını ~80 karakterde böl (taşmasın).
  const argParts = Object.entries(query).map(([k, v]) => `${k}=${v}`);
  const argLines = [''];
  for (const a of argParts) {
    const cur = argLines[argLines.length - 1];
    if ((cur + ' ' + a).length > 64 && cur) argLines.push(a);
    else argLines[argLines.length - 1] = cur ? `${cur} ${a}` : a;
  }
  line(['$ ', 'prompt'], ['search_cars ', 'cmd'], [argLines[0], 'dim']);
  for (const extra of argLines.slice(1)) line([' '.repeat(14) + extra, 'dim']);
  line(['  ', 'dim'], [`${search.totalMatched} of ${search.storeSize} listings match`, 'head']);
  const sHead = '  ' + pad('ID', 12) + pad('Title', 24) + pad('Year', 6) + lpad('Km', 9) + lpad('Price', 13) + '  ' + 'Location';
  line([sHead, 'head']);
  for (const r of search.results) {
    const loc = [r.city, r.district].filter(Boolean).join(' / ');
    line([
      '  ' + pad(r.id, 12) + pad(cut(r.title, 22), 24) + pad(r.year ?? '-', 6) + lpad(num(r.km), 9) +
        lpad(money(r.price, r.currency), 13) + '  ' + cut(loc, 24),
      'txt',
    ]);
  }
  gap();

  line(['$ ', 'prompt'], ['compare_cars ', 'cmd'], [`refs=[${refs.join(', ')}]`, 'dim']);
  const cHead = '  ' + pad('ID', 12) + pad('Year', 6) + lpad('Km', 9) + lpad('Km/yr', 8) + lpad('Price', 13) +
    lpad('vs median', 11) + lpad('Tramer', 9) + lpad('Chg/Paint', 11) + '  Data';
  line([cHead, 'head']);
  for (const r of cmp.rows) {
    const base = '  ' + pad(r.id, 12) + pad(r.year ?? '-', 6) + lpad(num(r.km), 9) + lpad(num(r.kmPerYear), 8);
    const price = lpad(money(r.price, currency.get(r.id)), 13);
    const delta = lpad(pct(r.priceVsSetMedianPct), 11);
    const dmg = r.completeness === 'full'
      ? lpad(num(r.tramerAmount), 9) + lpad(`${r.changedParts}/${r.paintedParts}`, 11)
      : lpad('-', 9) + lpad('-', 11);
    const cls = r.priceVsSetMedianPct === null || r.priceVsSetMedianPct === 0 ? 'txt' : r.priceVsSetMedianPct < 0 ? 'good' : 'bad';
    line([base + price, 'txt'], [delta, cls], [dmg + '  ' + r.completeness, 'txt']);
  }
  line([`  median ${money(cmp.stats.priceMedian, currency.get(refs[0]))}  ·  min ${num(cmp.stats.priceMin)}  ·  max ${num(cmp.stats.priceMax)}  ·  missing: ${cmp.missing.length}`, 'dim']);

  // ---- SVG ----
  const W = 900, PADX = 24, TOP = 52, LH = 20, FS = 13;
  const H = TOP + L.length * LH + 28;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const maxLen = Math.max(...L.map((segs) => segs.reduce((n, s) => n + s[0].length, 0)));
  if (maxLen * FS * 0.605 > W - 2 * PADX) die(`satır çok uzun (${maxLen} karakter)`);
  const rows = L.map((segs, i) => {
    if (!segs.length) return '';
    const spans = segs.map(([t, c]) => `<tspan class="${c}">${esc(t)}</tspan>`).join('');
    return `<text x="${PADX}" y="${TOP + 14 + i * LH}" xml:space="preserve">${spans}</text>`;
  }).join('\n  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="sahibinden-car-mcp sample output (synthetic data)">
  <style>
    text { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace; font-size: ${FS}px; fill: #c9d1d9; }
    .title { font-size: 12px; fill: #8b949e; }
    .prompt { fill: #3fb950; font-weight: bold; }
    .cmd { fill: #58a6ff; font-weight: bold; }
    .head { fill: #e6edf3; font-weight: bold; }
    .dim { fill: #8b949e; }
    .good { fill: #3fb950; }
    .bad { fill: #f0883e; }
    .warn { fill: #e3b341; font-weight: bold; }
  </style>
  <rect width="${W}" height="${H}" rx="10" fill="#0d1117"/>
  <rect width="${W}" height="36" rx="10" fill="#161b22"/>
  <rect y="26" width="${W}" height="10" fill="#161b22"/>
  <circle cx="22" cy="18" r="6" fill="#ff5f56"/>
  <circle cx="42" cy="18" r="6" fill="#ffbd2e"/>
  <circle cx="62" cy="18" r="6" fill="#27c93f"/>
  <text class="title" x="${W / 2}" y="22" text-anchor="middle">sahibinden-car-mcp — sample data</text>
  ${rows}
</svg>
`;
  const out = path.join(root, 'docs/assets/demo.svg');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, svg);
  clearTimeout(timer);
  cleanup();
  console.log(`Yazıldı: docs/assets/demo.svg (${W}x${H}, ${L.length} satır)`);
  process.exit(0);
} catch (e) {
  die(e instanceof Error ? e.message : String(e));
}
