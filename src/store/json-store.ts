import fs from 'node:fs';
import path from 'node:path';
import type { Listing, ListingSummary } from '../sahibinden/types.js';

export interface PricePoint {
  price: number;
  currency: string;
  capturedAt: string;
}

export interface StoredEntry {
  summary?: ListingSummary;
  listing?: Listing;
  priceHistory: PricePoint[];
}

export interface ImportedFile {
  file: string;
  importedAt: string;
  /** Dosyayı okuyan parser sürümü; yoksa eski kayıt (1) sayılır. */
  parserVersion?: number;
}

interface StoreData {
  version: 1;
  listings: Record<string, StoredEntry>;
  importedFiles: Record<string, ImportedFile>;
}

const empty = (): StoreData => ({ version: 1, listings: {}, importedFiles: {} });

/** Tek dosyalık JSON deposu. Senkron fs (küçük veri); yazma atomik (tmp + rename). */
export class JsonStore {
  private data: StoreData | null = null;

  constructor(private readonly filePath: string) {}

  load(): void {
    if (this.data) return;
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.data = empty();
        return;
      }
      throw err;
    }
    let parsed: Partial<StoreData>;
    try {
      parsed = JSON.parse(raw) as Partial<StoreData>;
    } catch {
      throw new Error(`Store dosyası bozuk (JSON okunamadı): ${this.filePath}`);
    }
    if (parsed.version !== 1 || typeof parsed.listings !== 'object' || !parsed.listings) {
      throw new Error(`Store dosyası tanınmayan biçimde: ${this.filePath}`);
    }
    this.data = { version: 1, listings: parsed.listings, importedFiles: parsed.importedFiles ?? {} };
  }

  save(): void {
    this.load();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  private entry(id: string): StoredEntry {
    this.load();
    const listings = this.data!.listings;
    return (listings[id] ??= { priceHistory: [] });
  }

  private trackPrice(e: StoredEntry, price: number | null, currency: string | null, at: string): void {
    if (price === null) return;
    const cur = currency ?? 'TL';
    const last = e.priceHistory[e.priceHistory.length - 1];
    if (last && last.price === price && last.currency === cur) return;
    e.priceHistory.push({ price, currency: cur, capturedAt: at });
  }

  upsertSummary(s: ListingSummary): void {
    const e = this.entry(s.id);
    e.summary = s;
    this.trackPrice(e, s.price, s.currency, s.capturedAt);
  }

  upsertListing(l: Listing): void {
    const e = this.entry(l.id);
    e.listing = l;
    this.trackPrice(e, l.price, l.currency, l.capturedAt);
  }

  all(): { id: string; entry: StoredEntry }[] {
    this.load();
    return Object.entries(this.data!.listings).map(([id, entry]) => ({ id, entry }));
  }

  get(id: string): StoredEntry | undefined {
    this.load();
    return this.data!.listings[id];
  }

  size(): number {
    this.load();
    return Object.keys(this.data!.listings).length;
  }

  hasFile(sha: string): boolean {
    this.load();
    return sha in this.data!.importedFiles;
  }

  getFile(sha: string): ImportedFile | undefined {
    this.load();
    return this.data!.importedFiles[sha];
  }

  markFile(sha: string, file: string, at: string, parserVersion?: number): void {
    this.load();
    this.data!.importedFiles[sha] = {
      file,
      importedAt: at,
      ...(parserVersion !== undefined ? { parserVersion } : {}),
    };
  }
}
