import fs from 'node:fs';
import path from 'node:path';

export interface LockOptions {
  now: () => number;
  /** Bu süreden eski kilit bayat sayılır ve devralınır (varsayılan 10 dk). */
  staleMs?: number;
  pid?: number;
}

/** Süreçler arası O_EXCL kilidi. Release fonksiyonu döner; başka süreç tutuyorsa null (busy). */
export function acquireLock(lockPath: string, o: LockOptions): (() => void) | null {
  const staleMs = o.staleMs ?? 600_000;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeSync(fd, JSON.stringify({ pid: o.pid ?? process.pid, at: o.now() }));
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* zaten silinmiş */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let at: number | null = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { at?: unknown };
        if (typeof parsed.at === 'number') at = parsed.at;
      } catch {
        /* okunamadı / yarım yazılmış: aşağıda mtime'a düşülür */
      }
      if (at === null) {
        try {
          at = fs.statSync(lockPath).mtimeMs;
        } catch {
          continue; // kilit bu arada silindi: yeniden dene
        }
      }
      if (o.now() - at <= staleMs) return null;
      try {
        fs.unlinkSync(lockPath); // bayat kilidi devral
      } catch {
        /* başka süreç devralmış olabilir */
      }
    }
  }
  return null;
}
