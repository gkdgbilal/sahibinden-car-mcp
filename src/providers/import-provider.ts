import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_FILE_BYTES, MAX_HTML_ARG, PARSER_VERSION } from '../config.js';
import { appliedFilterNames, evaluateQuery, sortListings } from '../sahibinden/filter.js';
import { detectPageType, parseListingPage, parseSearchPage } from '../sahibinden/parser.js';
import { searchContextOf } from '../sahibinden/search-context.js';
import type { Listing, ListingSummary, SearchQuery } from '../sahibinden/types.js';
import { ListingSummarySchema } from '../sahibinden/types.js';
import { buildSearchUrls } from '../sahibinden/url-builder.js';
import type { JsonStore, StoredEntry } from '../store/json-store.js';
import { log } from '../utils/logger.js';
import { parseRef } from './provider.js';
import type { IngestInput, IngestReport, Provider, SearchOutcome } from './provider.js';

const CHALLENGE_REASON =
  'Cloudflare doğrulama sayfası kaydedilmiş; sayfa tamamen yüklendikten sonra tekrar kaydedin';

const isHtmlName = (n: string) => /\.html?$/i.test(n);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Detay varsa detay (özet alanlarına indirgenmiş), yoksa özet. */
function summaryOf(e: StoredEntry): ListingSummary | null {
  const src = e.listing ?? e.summary;
  return src ? ListingSummarySchema.parse(src) : null;
}

export interface ImportProviderOptions {
  store: JsonStore;
  inboxDir: string;
  now: () => string;
  /** Dosyanın yakalanma zamanı (mtime). Verilmezse/null dönerse `now`; sonuç `now`'a kırpılır. */
  fileTime?: (file: string) => Date | null;
  /** Arama sayfalarının sidebar kategori ağacından marka/seri/motor yollarını öğrenir (katalog zenginleştirme). */
  learner?: { addFromHtml(html: string): number };
}

export class ImportProvider implements Provider {
  readonly name = 'import';
  private readonly store: JsonStore;
  private readonly inboxDir: string;
  private readonly now: () => string;
  private readonly fileTime: ((file: string) => Date | null) | undefined;
  private readonly learner: ImportProviderOptions['learner'];

  constructor(opts: ImportProviderOptions) {
    this.learner = opts.learner;
    this.store = opts.store;
    this.inboxDir = opts.inboxDir;
    this.now = opts.now;
    this.fileTime = opts.fileTime;
  }

  /** Dosya için yakalama zamanı: min(fileTime ?? now, now), ISO. */
  private capturedAtOf(file: string): string {
    const now = this.now();
    if (!this.fileTime) return now;
    let t: Date | null = null;
    try {
      t = this.fileTime(file);
    } catch {
      t = null;
    }
    if (!t || Number.isNaN(t.getTime())) return now;
    const nowMs = Date.parse(now);
    return Number.isNaN(nowMs) || t.getTime() <= nowMs ? t.toISOString() : now;
  }

  async stats() {
    return { storeSize: this.store.size(), inboxDir: this.inboxDir };
  }

  async search(q: SearchQuery): Promise<SearchOutcome> {
    const matched: (ListingSummary & { unknownFields: string[] })[] = [];
    let excludedOtherCurrency = 0;
    let excludedUnknown = 0;
    const now = new Date(this.now());
    for (const { entry } of this.store.all()) {
      const s = summaryOf(entry);
      if (!s) continue;
      // Detay alanları (kasa, hasar, motor ...) yalnızca tam Listing kaydında vardır.
      const ev = evaluateQuery(entry.listing ?? s, q, { now });
      if (ev.excludedOtherCurrency) excludedOtherCurrency++;
      if (ev.excludedUnknown) excludedUnknown++;
      if (ev.match) matched.push({ ...s, unknownFields: ev.unknownFields });
    }
    const sorted = sortListings(matched, q.sort);
    const outcome: SearchOutcome = {
      results: sorted.slice(0, q.limit),
      totalMatched: sorted.length,
      storeSize: this.store.size(),
      appliedFilters: appliedFilterNames(q),
      urlOnlyFilters: [],
      excludedOtherCurrency,
      excludedUnknown,
      searchUrls: buildSearchUrls(q),
    };
    if (this.store.size() === 0 || sorted.length === 0) {
      outcome.hint =
        `Aşağıdaki URL'leri tarayıcınızda açın, sonuç sayfasını Cmd+S ile ${this.inboxDir} klasörüne kaydedin, ` +
        'ardından import_listing_html çağırın.';
    }
    return outcome;
  }

  async getListing(ref: string) {
    const id = parseRef(ref);
    const e = id ? this.store.get(id) : undefined;
    return { listing: e?.listing ?? null, summary: e?.summary ?? null };
  }

  async ingest(input: IngestInput): Promise<IngestReport> {
    const report: IngestReport = { imported: [], skipped: [], storeSize: 0 };

    if (input.html !== undefined) {
      if (Buffer.byteLength(input.html, 'utf8') > MAX_HTML_ARG) {
        report.skipped.push({ file: null, reason: 'too-large' });
      } else {
        this.processHtml(input.html, null, 'inline-html', input.sourceUrl, report, undefined, input.cityHint, input.force);
      }
    } else {
      fs.mkdirSync(this.inboxDir, { recursive: true });
      const files = this.collectFiles(input.path, report);
      // sourceUrl yalnızca tek dosya için anlamlı.
      const sourceUrl = files.length === 1 ? input.sourceUrl : undefined;
      for (const file of files) this.processFile(file, sourceUrl, report, input.cityHint, input.force);
    }

    if (report.imported.length > 0) this.store.save();
    report.storeSize = this.store.size();
    return report;
  }

  /** path'i inbox ile sınırlar (göreli yol inbox'a göre çözülür) ve işlenecek dosyaları döner. */
  private collectFiles(p: string | undefined, report: IngestReport): string[] {
    const inboxReal = fs.realpathSync(this.inboxDir);
    const target = p === undefined || p === '' ? this.inboxDir : path.resolve(this.inboxDir, p);

    let st: fs.Stats;
    try {
      st = fs.lstatSync(target);
    } catch {
      this.assertInside(path.resolve(this.inboxDir), path.resolve(target));
      report.skipped.push({ file: target, reason: 'not-found' });
      return [];
    }
    if (st.isSymbolicLink()) {
      report.skipped.push({ file: target, reason: 'symlink' });
      return [];
    }
    this.assertInside(inboxReal, fs.realpathSync(target));

    if (st.isDirectory()) {
      const out: string[] = [];
      for (const d of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(target, d.name);
        if (d.isSymbolicLink()) {
          if (isHtmlName(d.name)) report.skipped.push({ file: full, reason: 'symlink' });
        } else if (d.isFile() && isHtmlName(d.name)) {
          out.push(full);
        }
      }
      return out;
    }
    if (!isHtmlName(target)) {
      report.skipped.push({ file: target, reason: 'not-html' });
      return [];
    }
    return [target];
  }

  private assertInside(root: string, target: string): void {
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Yol inbox klasörü dışında: yalnızca ${this.inboxDir} içindeki dosyalar içe aktarılabilir`);
    }
  }

  private processFile(file: string, sourceUrl: string | undefined, report: IngestReport, cityHint?: string, force?: boolean): void {
    const size = fs.statSync(file).size;
    if (size > MAX_FILE_BYTES) {
      report.skipped.push({ file, reason: 'too-large' });
      return;
    }
    const buf = fs.readFileSync(file);
    this.processHtml(buf.toString('utf8'), file, file, sourceUrl, report, sha256(buf), cityHint, force, this.capturedAtOf(file));
  }

  private processHtml(
    html: string,
    file: string | null,
    markName: string,
    sourceUrl: string | undefined,
    report: IngestReport,
    sha: string = sha256(html),
    cityHint?: string,
    force?: boolean,
    capturedAt: string = this.now(),
  ): void {
    // Aynı içerik: yalnızca güncel parser sürümüyle okunmuşsa atlanır; eski sürümlüyse (veya force) yeniden parse edilir.
    const seen = this.store.getFile(sha);
    if (seen && !force && (seen.parserVersion ?? 1) >= PARSER_VERSION) {
      report.skipped.push({ file, reason: 'duplicate' });
      return;
    }
    const pageType = detectPageType(html);
    if (pageType === 'challenge') {
      report.skipped.push({ file, reason: CHALLENGE_REASON });
      return;
    }
    if (pageType === 'unknown') {
      report.skipped.push({ file, reason: 'unknown-page' });
      return;
    }
    const ctx = {
      capturedAt,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(cityHint ? { cityHint } : {}),
    };
    try {
      if (pageType === 'search') {
        try {
          this.learner?.addFromHtml(html);
        } catch (err) {
          log.warn('catalog learn failed', { file, error: err instanceof Error ? err.message : String(err) });
        }
        const { items, warnings, totalCount, pageUrls } = parseSearchPage(html, ctx);
        for (const w of warnings) log.warn('search parse warning', { file, warning: w });
        if (items.length === 0) {
          report.skipped.push({ file, reason: 'no-listings-found' });
          return;
        }
        const sc = searchContextOf(pageUrls);
        const obsCtx = sc
          ? { searchKey: sc.searchKey, ...(sc.filters.length > 0 ? { filters: sc.filters } : {}) }
          : undefined;
        for (const it of items) this.store.upsertSummary(it, obsCtx);
        if (sc) {
          this.store.recordSearch(sc.searchKey, {
            path: sc.path,
            category: sc.category,
            filters: sc.filters,
            sorting: sc.sorting,
            filtersKnown: sc.filtersKnown,
            totalCount,
            at: capturedAt,
          });
        }
        report.imported.push({ file, pageType, count: items.length, ids: items.map((i) => i.id) });
      } else {
        const listing: Listing = parseListingPage(html, ctx);
        this.store.upsertListing(listing);
        report.imported.push({ file, pageType, count: 1, ids: [listing.id] });
      }
    } catch (err) {
      report.skipped.push({ file, reason: `parse-error: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    this.store.markFile(sha, markName, this.now(), PARSER_VERSION);
  }
}
