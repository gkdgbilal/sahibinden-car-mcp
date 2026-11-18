import fs from 'node:fs';
import path from 'node:path';

export interface AuditEntry {
  at: string;
  tool: string;
  url: string;
  pageType: string | null;
  httpStatus: number | null;
  imported: number;
  status: string;
}

const MAX_BYTES = 1_000_000;

/** Denetim kaydı: yalnızca zaman, URL, sayfa türü, HTTP durumu, sayı, durum. HTML/başlık/açıklama yazılmaz. */
export function appendAudit(file: string, e: AuditEntry): void {
  const safe: AuditEntry = {
    at: e.at,
    tool: e.tool,
    url: e.url.slice(0, 300),
    pageType: e.pageType,
    httpStatus: e.httpStatus,
    imported: e.imported,
    status: e.status,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    /* dosya henüz yok */
  }
  fs.appendFileSync(file, JSON.stringify(safe) + '\n', 'utf8');
}
