import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  browserWsUrl, connectToProfile, parseDevToolsActivePort, readDevToolsActivePort,
} from '../../src/browser/discovery.js';
import { openLoopbackTransport } from '../../src/browser/transport.js';
import { FakeTransport } from './fake-transport.js';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sahibinden-disc-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('parseDevToolsActivePort', () => {
  it('geçerli iki satır', () => {
    expect(parseDevToolsActivePort('45123\n/devtools/browser/abc-123\n')).toEqual({
      port: 45123,
      wsPath: '/devtools/browser/abc-123',
    });
  });
  it.each([
    ['boş', ''],
    ['tek satır', '45123\n'],
    ['port sayı değil', 'abc\n/devtools/browser/x\n'],
    ['port 0', '0\n/devtools/browser/x\n'],
    ['port 70000', '70000\n/devtools/browser/x\n'],
    ['yol bozuk', '9222\n/json/version\n'],
    ['yol dışa taşıyor', '9222\n/devtools/browser/x/../../y\n'],
  ])('geçersiz: %s', (_n, text) => {
    expect(parseDevToolsActivePort(text)).toBeNull();
  });
});

describe('readDevToolsActivePort / connectToProfile', () => {
  it('dosya yok → null; connectToProfile not-running (+ userAction)', async () => {
    const dir = tmp();
    expect(readDevToolsActivePort(dir)).toBeNull();
    await expect(connectToProfile(dir)).rejects.toMatchObject({
      code: 'not-running',
      userAction: expect.stringContaining('npm run chrome'),
    });
  });

  it('dosya var, bağlantı reddi (bayat) → not-running', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '45123\n/devtools/browser/abc\n');
    await expect(connectToProfile(dir, async () => { throw new Error('ECONNREFUSED'); })).rejects.toMatchObject({
      code: 'not-running',
    });
  });

  it('dosya var → loopback URL ile açar ve CdpClient döner', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '45123\n/devtools/browser/abc\n');
    let opened = '';
    const t = new FakeTransport();
    const client = await connectToProfile(dir, async (u) => ((opened = u), t));
    expect(opened).toBe('ws://127.0.0.1:45123/devtools/browser/abc');
    client.close();
    expect(t.closed).toBe(true);
  });

  it('browserWsUrl loopback', () => {
    expect(browserWsUrl({ port: 1234, wsPath: '/devtools/browser/x' })).toBe('ws://127.0.0.1:1234/devtools/browser/x');
  });
});

describe('openLoopbackTransport', () => {
  it.each([
    'ws://localhost:1/devtools/browser/x',
    'ws://10.0.0.1:9222/devtools/browser/x',
    'ws://127.0.0.1.evil.test:9222/devtools/browser/x',
    'wss://127.0.0.1:9222/devtools/browser/x',
    'ws://127.0.0.1:9222/devtools/page/x',
    'ws://user@127.0.0.1:9222/devtools/browser/x',
  ])('loopback dışı/biçimsiz adres bağlantı denenmeden reddedilir: %s', async (url) => {
    await expect(openLoopbackTransport(url)).rejects.toMatchObject({ code: 'not-running' });
  });

  it('kapalı yerel porta bağlanma denemesi not-running ile biter', async () => {
    await expect(openLoopbackTransport('ws://127.0.0.1:1/devtools/browser/x', 2000)).rejects.toMatchObject({
      code: 'not-running',
    });
  });
});
