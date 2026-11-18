import fs from 'node:fs';
import path from 'node:path';
import type { Listing, ListingSummary } from '../sahibinden/types.js';
import { derivePriceHistory, insertObservation, migrateV1, observationTime, STORE_SCHEMA_VERSION } from './schema.js';
import type {
  ImportedFile,
  InsightStore,
  Observation,
  PricePoint,
  RecordSearchInfo,
  RecordView,
  SearchInfo,
  StoreDataV1,
  StoreDataV2,
  StoredEntryV2,
  UrlFilterFlag,
  WatchItem,
} from './schema.js';

export type { ImportedFile, Observation, PricePoint, SearchInfo, UrlFilterFlag, WatchItem };
/** Geriye uyum: v2 kaydı. */
export type StoredEntry = StoredEntryV2;

/** Gözlem bağlamı (yalnızca arama sayfası öğelerinde). */
export interface ObservationContext {
  searchKey?: string;
  filters?: UrlFilterFlag[];
}

export interface JsonStoreOptions {
  /** Taşıma zamanı için saat (ISO). Varsayılan: sistem saati. */
  now?: () => string;
}

const BACKUP_NAME = 'store.v1-backup.json';

const empty = (): StoreDataV2 => ({ version: 2, listings: {}, importedFiles: {}, searches: {}, watchlist: {} });

/** Tek dosyalık JSON deposu (şema v2). Senkron fs (küçük veri); yazma atomik (tmp + rename). */
export class JsonStore implements InsightStore {
  private data: StoreDataV2 | null = null;
  /** v1 dosyası yüklendiyse özgün içerik: ilk save()'den önce bir kez yedeklenir. */
  private v1Raw: string | null = null;
  private dirty = false;
  private loadedMtimeMs: number | null = null;
  private readonly nowIso: () => string;

  constructor(
    private readonly filePath: string,
    opts: JsonStoreOptions = {},
  ) {
    this.nowIso = opts.now ?? (() => new Date().toISOString());
  }

  load(): void {
    if (this.data) return;
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.data = empty();
        this.loadedMtimeMs = null;
        return;
      }
      throw err;
    }
    let parsed: { version?: unknown; listings?: unknown; importedFiles?: unknown; searches?: unknown; watchlist?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Store dosyası bozuk (JSON okunamadı): ${this.filePath}`);
    }
    const unrecognized = () => new Error(`Store dosyası tanınmayan biçimde: ${this.filePath}`);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number') throw unrecognized();
    if (parsed.version > STORE_SCHEMA_VERSION) {
      throw new Error(
        `Store daha yeni bir sürümle yazılmış (v${parsed.version}); sahibinden-car-mcp'yi güncelleyin. Dosya değiştirilmedi.`,
      );
    }
    if ((parsed.version !== 1 && parsed.version !== 2) || typeof parsed.listings !== 'object' || !parsed.listings) {
      throw unrecognized();
    }
    if (parsed.version === 1) {
      this.data = migrateV1(
        {
          version: 1,
          listings: parsed.listings as StoreDataV1['listings'],
          importedFiles: (parsed.importedFiles ?? {}) as StoreDataV1['importedFiles'],
        },
        this.nowIso(),
      );
      this.v1Raw = raw;
      this.dirty = true;
    } else {
      const d = parsed as Partial<StoreDataV2>;
      this.data = {
        ...d,
        version: 2,
        listings: d.listings!,
        importedFiles: d.importedFiles ?? {},
        searches: d.searches ?? {},
        watchlist: d.watchlist ?? {},
      };
      this.dirty = false;
    }
    this.loadedMtimeMs = this.mtimeMs();
  }

  private mtimeMs(): number | null {
    try {
      return fs.statSync(this.filePath).mtimeMs;
    } catch {
      return null;
    }
  }

  /** Bellekte kaydedilmemiş değişiklik yoksa ve dosya başka bir süreç tarafından değiştiyse yeniden yükler (08 §2.4). */
  private refreshIfStale(): void {
    this.load();
    if (this.dirty) return;
    const m = this.mtimeMs();
    if (m !== null && m !== this.loadedMtimeMs) {
      this.data = null;
      this.load();
    }
  }

  save(): void {
    this.load();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    if (this.v1Raw !== null) {
      // Taşınmış v1 dosyasının ilk yazımı: özgün içerik bir kez yedeklenir; yedek varsa dokunulmaz.
      try {
        fs.writeFileSync(path.join(dir, BACKUP_NAME), this.v1Raw, { encoding: 'utf8', flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      this.v1Raw = null;
    }
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    fs.renameSync(tmp, this.filePath);
    this.dirty = false;
    this.loadedMtimeMs = this.mtimeMs();
  }

  private entry(id: string): StoredEntryV2 {
    this.load();
    const listings = this.data!.listings;
    return (listings[id] ??= { priceHistory: [], observations: [] });
  }

  /** Gözlemi ekler; anlık görüntü yalnızca aynı türdeki yaklaşık-olmayan en yeni gözlemden eski değilse değişir. */
  private observe(
    e: StoredEntryV2,
    kind: Observation['kind'],
    snap: { price: number | null; currency: string | null; capturedAt: string },
    ctx: ObservationContext | undefined,
  ): boolean {
    const o: Observation = {
      at: snap.capturedAt,
      kind,
      price: snap.price,
      currency: snap.currency,
      ...(kind === 'search' && ctx?.searchKey ? { searchKey: ctx.searchKey } : {}),
      ...(kind === 'search' && ctx?.filters && ctx.filters.length > 0 ? { filters: [...ctx.filters] } : {}),
    };
    const { list, inserted } = insertObservation(e.observations ?? [], o);
    e.observations = list;
    if (inserted) e.priceHistory = derivePriceHistory(list);
    this.dirty = true;
    const t = observationTime(o.at);
    return list.every((x) => x.kind !== kind || x.approx || observationTime(x.at) <= t);
  }

  upsertSummary(s: ListingSummary, ctx?: ObservationContext): void {
    const e = this.entry(s.id);
    if (this.observe(e, 'search', s, ctx)) e.summary = s;
  }

  upsertListing(l: Listing, ctx?: ObservationContext): void {
    const e = this.entry(l.id);
    if (this.observe(e, 'listing', l, ctx)) e.listing = l;
  }

  /** Arama kaydı: first/last = min/max; totalCount/sorting/filtre bilgisi en son gözlemden. */
  recordSearch(key: string, info: RecordSearchInfo): void {
    this.load();
    const { at, ...rest } = info;
    const prev = this.data!.searches[key];
    if (!prev) {
      this.data!.searches[key] = { ...rest, firstObservedAt: at, lastObservedAt: at };
    } else {
      const t = observationTime(at);
      const newest = t >= observationTime(prev.lastObservedAt);
      this.data!.searches[key] = {
        ...(newest ? rest : { path: prev.path, category: prev.category, filters: prev.filters, sorting: prev.sorting, filtersKnown: prev.filtersKnown, totalCount: prev.totalCount }),
        firstObservedAt: t < observationTime(prev.firstObservedAt) ? at : prev.firstObservedAt,
        lastObservedAt: newest ? at : prev.lastObservedAt,
      };
    }
    this.dirty = true;
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
    this.dirty = true;
  }

  // ---------- InsightStore ----------

  private view(id: string, e: StoredEntryV2): RecordView | undefined {
    const best = e.listing ?? e.summary;
    if (!best) return undefined;
    return { id, best, full: e.listing !== undefined, observations: e.observations ?? [] };
  }

  records(): RecordView[] {
    this.load();
    const out: RecordView[] = [];
    for (const [id, e] of Object.entries(this.data!.listings)) {
      const v = this.view(id, e);
      if (v) out.push(v);
    }
    return out;
  }

  record(id: string): RecordView | undefined {
    this.load();
    const e = this.data!.listings[id];
    return e ? this.view(id, e) : undefined;
  }

  searches(): Readonly<Record<string, SearchInfo>> {
    this.load();
    return this.data!.searches;
  }

  watchlist(): Readonly<Record<string, WatchItem>> {
    this.refreshIfStale();
    return this.data!.watchlist;
  }

  watchUpsert(id: string, patch: Partial<WatchItem>, at: string): WatchItem {
    this.refreshIfStale();
    const list = this.data!.watchlist;
    const prev = list[id];
    const { note, addedAt: _addedAt, updatedAt: _updatedAt, ...rest } = patch;
    const other = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<WatchItem>;
    const next: WatchItem = prev
      ? { ...prev, ...other, updatedAt: at }
      : { priceAtAdd: null, currencyAtAdd: null, ...other, addedAt: at, updatedAt: at };
    if (note !== undefined) {
      if (note === '') delete next.note;
      else next.note = note;
    }
    list[id] = next;
    this.dirty = true;
    return next;
  }

  watchRemove(id: string): boolean {
    this.refreshIfStale();
    const list = this.data!.watchlist;
    if (!(id in list)) return false;
    delete list[id];
    this.dirty = true;
    return true;
  }
}
