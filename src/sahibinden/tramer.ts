import { foldTr, parseTrDate } from './normalize.js';
import type { TramerRecord, TramerStatus } from './types.js';

export interface TramerExtraction {
  amount: number | null;
  records: TramerRecord[];
  status: TramerStatus;
}

const WINDOW = 80;
const MAX_AMOUNT = 5_000_000;
const NOTE_MAX = 60;
/** Tutarın hemen önünde bunlar geçiyorsa tutar tramer değil fiyat/ödeme bilgisidir. */
const NON_TRAMER_CONTEXT = /(fiyat|satis|bedel|pesin|takas|kredi|taksit|kapora|pazarlik|piyasa)[^\d]{0,12}$/;
/** Anahtar kelimenin hemen arkasında gelen olumsuzluk ("tramer kaydı yoktur"). */
const NEGATION_AFTER =
  /^[\s:;,.\-]*(?:(?:kayd[ıi]|kayit|hasar kayd[ıi]|hasar kayit|sorgusu)[\s:;,.\-]*)?(?:yok|bulunma|bulunmuyor|mevcut degil|temiz)/;

const AMOUNT_RE =
  /(?<![\d.,])(₺\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(bin(?![a-z0-9]))?\s*(₺|tl(?![a-z0-9])|try(?![a-z0-9])|lira(?![a-z0-9]))?/g;
const DATE_RE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/g;

interface Event {
  pos: number;
  end: number;
  kind: 'date' | 'amount';
  amount?: number;
  date?: string;
}

/** Uzunluğu koruyan Türkçe katlama (indeksler orijinal metinle hizalı kalır). */
function alignedFold(text: string): string {
  const f = foldTr(text);
  return f.length === text.length ? f : text.toLowerCase();
}

function findAmounts(f: string, from: number, to: number): Event[] {
  const out: Event[] = [];
  const slice = f.slice(from, to);
  AMOUNT_RE.lastIndex = 0;
  for (let m = AMOUNT_RE.exec(slice); m; m = AMOUNT_RE.exec(slice)) {
    const [whole, prefix, intPart, dec, bin, cur] = m;
    if (!prefix && !bin && !cur) continue;
    let v = Number(`${intPart!.replace(/\./g, '')}.${dec ?? '0'}`);
    if (bin) v *= 1000;
    v = Math.round(v);
    if (!Number.isFinite(v) || v <= 0 || v > MAX_AMOUNT) continue;
    const pos = from + m.index;
    if (NON_TRAMER_CONTEXT.test(f.slice(Math.max(0, pos - 20), pos))) continue;
    out.push({ pos, end: pos + whole.trimEnd().length, kind: 'amount', amount: v });
  }
  return out;
}

function findDates(f: string, from: number, to: number): Event[] {
  const out: Event[] = [];
  const slice = f.slice(from, to);
  DATE_RE.lastIndex = 0;
  for (let m = DATE_RE.exec(slice); m; m = DATE_RE.exec(slice)) {
    const iso = parseTrDate(`${m[1]}/${m[2]}/${m[3]}`);
    out.push({ pos: from + m.index, end: from + m.index + m[0].length, kind: 'date', ...(iso ? { date: iso } : {}) });
  }
  return out;
}

/**
 * İlan açıklamasından tramer bilgisini çıkarır (satıcı beyanı; doğrulanmaz).
 * Yalnızca "tramer" anahtar kelimesinin ±80 karakter yakınındaki tutarlar sayılır.
 */
export function extractTramerFromText(text: string | null | undefined): TramerExtraction {
  if (!text) return { amount: null, records: [], status: 'unknown' };
  const f = alignedFold(text);

  let negated = 0;
  let positive = 0;
  const events = new Map<number, Event>();
  const windows: [number, number][] = [];
  for (const m of f.matchAll(/tramer[a-z]*/g)) {
    const start = m.index!;
    const end = start + m[0].length;
    const word = m[0];
    const isNeg = word === 'tramersiz' || NEGATION_AFTER.test(f.slice(end, end + 30));
    if (isNeg) {
      negated++;
      continue;
    }
    positive++;
    const from = Math.max(0, start - WINDOW);
    const to = Math.min(f.length, end + WINDOW);
    windows.push([from, to]);
    for (const e of [...findAmounts(f, from, to), ...findDates(f, from, to)]) events.set(e.pos, e);
  }

  let sorted = [...events.values()].sort((a, b) => a.pos - b.pos);
  // "toplam 14.500 TL (5.500 + 9.000)" gibi bir tutar diğerlerinin toplamıysa toplam sayılır, çift sayılmaz.
  const amts = sorted.filter((e) => e.kind === 'amount');
  if (amts.length >= 3) {
    const total = amts.reduce((s, e) => s + e.amount!, 0);
    const dup = amts.find((e) => total - e.amount! === e.amount);
    if (dup) sorted = sorted.filter((e) => e !== dup);
  }

  const windowEnd = (pos: number) => windows.find(([a, b]) => pos >= a && pos < b)?.[1] ?? pos;
  const records: TramerRecord[] = [];
  interface Draft { rec: TramerRecord; startPos: number; lastEnd: number; tokens: [number, number][] }
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  for (const e of sorted) {
    if (e.kind === 'date') {
      const attach = cur && cur.rec.date === undefined && (cur.rec.amount === undefined || e.pos - cur.lastEnd <= 12);
      if (attach && cur) {
        if (e.date) cur.rec.date = e.date;
        cur.tokens.push([e.pos, e.end]);
        cur.lastEnd = e.end;
        continue;
      }
      cur = { rec: e.date ? { date: e.date } : {}, startPos: e.pos, lastEnd: e.end, tokens: [[e.pos, e.end]] };
      drafts.push(cur);
    } else if (cur && cur.rec.amount === undefined) {
      cur.rec.amount = e.amount!;
      cur.tokens.push([e.pos, e.end]);
      cur.lastEnd = e.end;
    } else {
      cur = { rec: { amount: e.amount! }, startPos: e.pos, lastEnd: e.end, tokens: [[e.pos, e.end]] };
      drafts.push(cur);
    }
  }
  drafts.forEach((d, i) => {
    const next = drafts[i + 1];
    const spanEnd = Math.min(next ? next.startPos : Infinity, windowEnd(d.startPos), d.lastEnd + 40);
    let note = '';
    let at = d.startPos;
    for (const [a, b] of d.tokens) {
      note += text.slice(at, a) + ' ';
      at = b;
    }
    note += text.slice(at, Math.max(at, spanEnd));
    note = note
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—:;,.()]+|[\s\-–—:;,.()]+$/g, '')
      .slice(0, NOTE_MAX)
      .trim();
    const rec: TramerRecord = { ...d.rec };
    if (note) rec.note = note;
    records.push(rec);
  });

  const amount = records.reduce<number | null>((s, r) => (r.amount === undefined ? s : (s ?? 0) + r.amount), null);
  const carpma = /carp(?:ma|isma)(?![a-z])(?![\s:;,.\-]*(?:yok|bulunma))/.test(f);
  let status: TramerStatus;
  if (amount !== null) status = 'amount';
  else if (positive > 0 || carpma) status = 'mentioned';
  else if (negated > 0) status = 'none';
  else status = 'unknown';
  return { amount, records, status };
}
