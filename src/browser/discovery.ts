import fs from 'node:fs';
import path from 'node:path';
import { CdpClient } from './cdp-client.js';
import { BrowserError, START_CHROME_HINT } from './errors.js';
import { openLoopbackTransport } from './transport.js';
import type { Transport } from './transport.js';

export interface DevToolsPort {
  port: number;
  wsPath: string;
}

/** DevToolsActivePort: 1. satır port, 2. satır /devtools/browser/<id>. Geçersizse null. */
export function parseDevToolsActivePort(text: string): DevToolsPort | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length < 2) return null;
  const [portLine, wsPath] = lines as [string, string];
  if (!/^\d{1,5}$/.test(portLine)) return null;
  const port = Number(portLine);
  if (port < 1 || port > 65535) return null;
  if (!/^\/devtools\/browser\/[\w-]+$/.test(wsPath)) return null;
  return { port, wsPath };
}

export function readDevToolsActivePort(profileDir: string): DevToolsPort | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8');
  } catch {
    return null;
  }
  return parseDevToolsActivePort(text);
}

export function browserWsUrl(i: DevToolsPort): string {
  return `ws://127.0.0.1:${i.port}${i.wsPath}`;
}

/** Profilin DevToolsActivePort dosyasından loopback CDP adresini bulup bağlanır. Başarısızsa 'not-running'. */
export async function connectToProfile(
  profileDir: string,
  open: (url: string) => Promise<Transport> = openLoopbackTransport,
): Promise<CdpClient> {
  const info = readDevToolsActivePort(profileDir);
  if (!info) {
    throw new BrowserError('not-running', 'Adanmış Chrome çalışmıyor (DevToolsActivePort yok)', START_CHROME_HINT);
  }
  let transport: Transport;
  try {
    transport = await open(browserWsUrl(info));
  } catch (err) {
    if (err instanceof BrowserError && err.code === 'unsupported-runtime') throw err;
    throw new BrowserError('not-running', "Chrome'a bağlanılamadı (dosya bayat olabilir)", START_CHROME_HINT);
  }
  return new CdpClient(transport);
}
