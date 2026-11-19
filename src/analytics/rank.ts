import { evaluateQuery } from '../sahibinden/filter.js';
import { foldTr } from '../sahibinden/normalize.js';
import type { Listing, SearchQuery } from '../sahibinden/types.js';
import { observationTime } from '../store/schema.js';
import type { RecordView } from '../store/schema.js';
import { adjustedPrice, fitSlopes, MIN_PLAUSIBLE_PRICE, positionOf } from './market.js';
import type { DamageGroup, PositionBand, SlopeFit } from './market.js';
import { assessRisk } from './risk.js';
import type { RiskFlag } from './risk.js';
import { DAY_MS } from './history.js';
import { describe, median, tukeyFences } from './stats.js';

// "En mantıklı N ilan": yerel store'daki ilanları filtreler, aynı model grubunun km/yıl düzeltilmiş piyasa medyanına
// göre konumlar, risk bayraklarını ekler ve puanlar. Saf: saat parametre, I/O yok. Fiyatlar İSTEK fiyatıdır (satış değil).

export type Verdict = 'strong-candidate' | 'fair' | 'overpriced' | 'check-first' | 'risky' | 'no-baseline';

/** Grup başına en az ilan: altında piyasa tabanı kurulmaz (konum hesaplanmaz). */
export const MIN_GROUP_N = 5;
/** Km/yıl eğimi için en az ilan (market.ts MIN_FIT_N ile aynı). */
const MIN_FIT_N = 12;
const OUTLIER_MIN_N = 8;

export interface RankOptions {
  top: number;
  /** Bu günden eski gözlemli ilanlar elenir. */
  maxAgeDays: number;
}

export interface RankedListing {
  rank: number;
  id: string;
  url: string;
  title: string;
  year: number | null;
  km: number | null;
  price: number;
  city: string | null;
  group: string;
  /** Grup medyanına taşınmış (km/yıl düzeltilmiş) fiyat; baz yoksa null. */
  adjustedPrice: number | null;
  /** (düzeltilmiş fiyat / grup medyanı − 1) × 100; negatif = piyasadan ucuz. */
  vsMarketPct: number | null;
  position: { percentile: number; band: PositionBand } | null;
  damage: DamageGroup;
  damageEvidence: 'detail' | 'search-filter' | 'none';
  tramer: string | null;
  risks: RiskFlag[];
  positives: string[];
  score: number;
  verdict: Verdict;
  reasons: string[];
  nextSteps: string[];
}

export interface GroupMarket {
  group: string;
  n: number;
  medianAdjustedPrice: number | null;
  refYear: number | null;
  refKm: number | null;
  kmSlopePctPer10k: number | null;
  yearSlopePct: number | null;
  confidence: 'insufficient' | 'low' | 'medium' | 'high';
  note: string;
}

export interface RankResult {
  ranked: RankedListing[];
  /** Yüksek riskli ya da çok zayıf puanlı ilanlar; ana listeden ayrı gösterilir. */
  avoid: RankedListing[];
  groups: GroupMarket[];
  considered: number;
  excluded: { noPrice: number; otherCurrency: number; stale: number; implausible: number; outlier: number; noMatch: number };
  warnings: string[];
}

const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const trNum = (x: number) => r1(x).toFixed(1).replace('.', ',');

/**
 * Grup anahtarı: seri adı. Arama satırı kayıtlarında marka yoktur (yalnızca seri), detay kayıtlarında vardır; marka
 * anahtara girerse aynı model ikiye bölünür. Seri yoksa başlığın ilk iki sözcüğü.
 */
const groupKeyOf = (v: RecordView): string => {
  const series = foldTr(v.best.series ?? '').replace(/[^a-z0-9]+/g, '');
  return series ? `s|${series}` : `t|${foldTr(v.best.title).split(/\s+/).slice(0, 2).join('')}`;
};
const groupLabelOf = (v: RecordView): string => {
  const b = v.best;
  const label = [b.brand, b.series].filter(Boolean).join(' ');
  return label || b.title.split(/\s+/).slice(0, 2).join(' ');
};

interface Cand {
  view: RecordView;
  key: string;
  label: string;
  price: number;
  year: number | null;
  km: number | null;
}

const confidenceOfGroup = (n: number, fit: SlopeFit | null): GroupMarket['confidence'] => {
  if (n < MIN_GROUP_N) return 'insufficient';
  if (n < 10 || !fit || (fit.bKm === null && fit.bYear === null)) return 'low';
  return n >= 25 && fit.bKm !== null && fit.bYear !== null ? 'high' : 'medium';
};

/** Puan: 50 taban; piyasadan her %1 ucuzluk +1,5 (±30 ile sınırlı); risk ve eksik bilgi düşürür; 0–100. */
function scoreOf(vsMarketPct: number | null, risks: RiskFlag[], positives: string[], hasDetail: boolean): number {
  let s = 50;
  if (vsMarketPct !== null) s += Math.max(-30, Math.min(30, -vsMarketPct)) * 1.5;
  for (const f of risks) s -= f.severity === 'high' ? 25 : f.severity === 'medium' ? 10 : 3;
  s += Math.min(6, positives.length * 2);
  if (!hasDetail) s -= 5;
  return Math.max(0, Math.min(100, r0(s)));
}

function verdictOf(vs: number | null, risks: RiskFlag[], hasBaseline: boolean, hasDetail: boolean): Verdict {
  if (risks.some((f) => f.severity === 'high')) return 'risky';
  if (!hasBaseline || vs === null) return 'no-baseline';
  // Piyasanın çok altı: fırsattan çok şüphe sebebi (gizli hasar, dolandırıcılık, km oyunu).
  if (vs <= -25) return 'check-first';
  if (vs <= -8) return hasDetail ? 'strong-candidate' : 'check-first';
  if (vs <= 5) return 'fair';
  return 'overpriced';
}

function reasonsOf(c: Cand, vs: number | null, pos: { percentile: number } | null, risks: RiskFlag[], verdict: Verdict, label: string, n: number): string[] {
  const out: string[] = [];
  if (vs !== null) {
    out.push(
      `${label} grubunun (n=${n}) km/yıl düzeltilmiş medyanına göre %${trNum(Math.abs(vs))} ${vs < 0 ? 'ucuz' : vs > 0 ? 'pahalı' : 'aynı düzeyde'}` +
        (pos ? ` (emsallerin ~%${pos.percentile}'i bu fiyatın altında)` : '') + '.',
    );
  } else {
    out.push(`Piyasa tabanı kurulamadı (${label} grubunda yeterli emsal yok).`);
  }
  if (verdict === 'check-first' && vs !== null && vs <= -25) out.push('Fiyat piyasanın çok altında: gizli hasar, km oyunu ya da sahte ilan olasılığını eleyin.');
  for (const f of risks.filter((x) => x.severity !== 'low').slice(0, 3)) out.push(f.text + '.');
  return out;
}

function nextStepsOf(verdict: Verdict, hasDetail: boolean, risks: RiskFlag[]): string[] {
  const steps: string[] = [];
  if (!hasDetail) steps.push('İlan detay sayfasını kaydedip içe aktarın (hasar/tramer/açıklama burada görülür).');
  if (verdict === 'strong-candidate' || verdict === 'fair') steps.push('Tramer sorgusu ve bağımsız ekspertiz yaptırın; satıcının beyanlarını belgeyle doğrulayın.');
  if (verdict === 'check-first') steps.push('Fiyat/bilgi tutarsızlığının nedenini satıcıdan yazılı isteyin; görmeden kapora vermeyin.');
  if (verdict === 'risky') steps.push('Yüksek risk bayrakları çözülmeden ilerlemeyin.');
  if (verdict === 'overpriced') steps.push('Pazarlık payı için benzer ilanların fiyatlarını referans gösterin.');
  if (risks.some((f) => f.code === 'km-low')) steps.push('Düşük km için servis/bakım kayıtlarını ve OBD km verisini isteyin.');
  return steps;
}

/**
 * `query` yerel filtredir (search_cars ile aynı kurallar). Piyasa tabanı kullanıcının kendi filtrelediği grup üzerinden
 * kurulur; model grupları (marka+seri) ayrı değerlendirilir. Eğimler market_stats ile aynı yöntemle (Theil–Sen) bulunur.
 */
export function rankListings(
  views: readonly RecordView[],
  query: Partial<SearchQuery>,
  opts: RankOptions,
  now: Date,
): RankResult {
  const excluded = { noPrice: 0, otherCurrency: 0, stale: 0, implausible: 0, outlier: 0, noMatch: 0 };
  const warnings: string[] = [
    'Fiyatlar ilan (istek) fiyatıdır, satış fiyatı değildir; sonuçlar yalnızca kaydettiğiniz sayfalara dayanır.',
    'Hasar, boya ve tramer bilgisi satıcı beyanıdır; ekspertiz ve tramer sorgusu yerine geçmez. Bu bir alım tavsiyesi değildir.',
  ];

  const cands: Cand[] = [];
  const staleBefore = now.getTime() - opts.maxAgeDays * DAY_MS;
  for (const v of views) {
    if (!evaluateQuery(v.best, query, { now }).match) {
      excluded.noMatch++;
      continue;
    }
    const price = v.best.price;
    if (price === null) { excluded.noPrice++; continue; }
    if (v.best.currency !== null && v.best.currency !== 'TL') { excluded.otherCurrency++; continue; }
    if (price < MIN_PLAUSIBLE_PRICE) { excluded.implausible++; continue; }
    const lastSeen = Math.max(...v.observations.map((o) => observationTime(o.at)), observationTime(v.best.capturedAt));
    if (lastSeen < staleBefore) { excluded.stale++; continue; }
    cands.push({ view: v, key: groupKeyOf(v), label: groupLabelOf(v), price, year: v.best.year, km: v.best.km });
  }

  // Gruplara ayır; fiyat aykırı değerlerini (Tukey, log) baz hesabından çıkar ama sıralamada tut.
  const byGroup = new Map<string, Cand[]>();
  for (const c of cands) byGroup.set(c.key, [...(byGroup.get(c.key) ?? []), c]);

  const groups: GroupMarket[] = [];
  const baseline = new Map<string, { label: string; conf: GroupMarket['confidence']; fit: SlopeFit | null; ref: { year: number; km: number } | null; adjById: Map<string, number>; dist: ReturnType<typeof describe> | null; values: number[]; medianAdj: number | null; n: number }>();

  for (const [key, list] of byGroup) {
    // Etiket: grupta marka bilen bir kayıt varsa onunki ("Renault Taliant"), yoksa seri adı.
    const label = [...list].sort((a, b) => b.label.length - a.label.length)[0]!.label;
    let basis = list;
    if (basis.length >= OUTLIER_MIN_N) {
      const f = tukeyFences(basis.map((c) => Math.log(c.price)));
      const kept = basis.filter((c) => Math.log(c.price) >= f.lo && Math.log(c.price) <= f.hi);
      excluded.outlier += basis.length - kept.length;
      basis = kept;
    }
    const withYK = basis.filter((c): c is Cand & { year: number; km: number } => c.year !== null && c.km !== null);
    const hasRef = withYK.length >= MIN_GROUP_N;
    const ref = hasRef ? { year: r0(median(withYK.map((c) => c.year))), km: r0(median(withYK.map((c) => c.km))) } : null;
    let fit: SlopeFit | null = null;
    if (ref && withYK.length >= MIN_FIT_N) fit = fitSlopes(withYK, ref.km);

    // Düzeltilmiş fiyatlar (tüm adaylar için; eğim kapalıysa ham fiyat).
    const adjById = new Map<string, number>();
    for (const c of list) {
      adjById.set(
        c.view.id,
        ref && c.year !== null && c.km !== null && fit ? adjustedPrice({ price: c.price, year: c.year, km: c.km }, fit, ref) : c.price,
      );
    }
    const baseVals = basis.map((c) => adjById.get(c.view.id)!);
    const enough = basis.length >= MIN_GROUP_N;
    const dist = enough ? describe(baseVals) : null;
    const medianAdj = dist ? dist.median : null;
    const conf = confidenceOfGroup(basis.length, fit);
    baseline.set(key, { label, conf, fit, ref, adjById, dist, values: baseVals, medianAdj, n: basis.length });

    const notes: string[] = [];
    if (!enough) notes.push(`Yeterli emsal yok (n=${basis.length} < ${MIN_GROUP_N}); piyasa konumu hesaplanmadı.`);
    else if (!fit || (fit.bKm === null && fit.bYear === null)) notes.push('Km/yıl düzeltmesi yapılamadı: karşılaştırma ham fiyat üzerinden, yaklaşık.');
    if (fit) notes.push(...fit.warnings);
    groups.push({
      group: label,
      n: basis.length,
      medianAdjustedPrice: medianAdj === null ? null : r0(medianAdj),
      refYear: ref?.year ?? null,
      refKm: ref?.km ?? null,
      kmSlopePctPer10k: fit?.bKm != null ? r1((Math.exp(fit.bKm * 10_000) - 1) * 100) : null,
      yearSlopePct: fit?.bYear != null ? r1((Math.exp(fit.bYear) - 1) * 100) : null,
      confidence: conf,
      note: notes.join(' '),
    });
  }

  const all: RankedListing[] = cands.map((c) => {
    const bl = baseline.get(c.key)!;
    const adj = bl.adjById.get(c.view.id) ?? null;
    const hasBaseline = bl.medianAdj !== null && bl.dist !== null;
    const vs = hasBaseline && adj !== null ? r1((adj / bl.medianAdj! - 1) * 100) : null;
    const pos = hasBaseline && adj !== null ? positionOf(bl.values, bl.dist!, adj) : null;
    const risk = assessRisk(c.view, now, opts.maxAgeDays);
    const hasDetail = c.view.full;
    const verdict = verdictOf(vs, risk.flags, hasBaseline, hasDetail);
    const score = scoreOf(vs, risk.flags, risk.positives, hasDetail);
    const b = c.view.best as Partial<Listing> & RecordView['best'];
    return {
      rank: 0,
      id: c.view.id,
      url: b.url,
      title: b.title,
      year: c.year,
      km: c.km,
      price: c.price,
      city: b.city,
      group: bl.label,
      adjustedPrice: adj === null || !hasBaseline ? null : r0(adj),
      vsMarketPct: vs,
      position: pos ? { percentile: pos.percentile, band: pos.band } : null,
      damage: risk.damageGroup,
      damageEvidence: risk.damageEvidence,
      tramer: risk.tramer,
      risks: risk.flags,
      positives: risk.positives,
      score,
      verdict,
      reasons: [
        ...reasonsOf(c, vs, pos, risk.flags, verdict, bl.label, bl.n),
        ...(vs !== null && bl.conf === 'low' ? ['Piyasa tabanı düşük güvenli (emsal az ya da km/yıl düzeltmesi yapılamadı); sonuç yaklaşıktır.'] : []),
      ],
      nextSteps: nextStepsOf(verdict, hasDetail, risk.flags),
    };
  });

  // Yüksek riskliler ve piyasa tabanı olmayanlar ana listede yer almaz: önce riskli olmayanlar puana göre.
  const sortFn = (a: RankedListing, b: RankedListing) => b.score - a.score || a.price - b.price || (a.id < b.id ? -1 : 1);
  const main = all.filter((r) => r.verdict !== 'risky' && r.verdict !== 'no-baseline').sort(sortFn);
  const noBase = all.filter((r) => r.verdict === 'no-baseline').sort(sortFn);
  const risky = all.filter((r) => r.verdict === 'risky').sort(sortFn);
  const ranked = [...main, ...noBase].slice(0, opts.top).map((r, i) => ({ ...r, rank: i + 1 }));
  const avoid = risky.slice(0, 5).map((r, i) => ({ ...r, rank: i + 1 }));

  if (cands.length === 0) warnings.push('Filtrelere uyan, fiyatı ve gözlemi güncel ilan yok; önce arama sayfalarını içe aktarın.');
  if (groups.some((g) => g.confidence === 'insufficient')) warnings.push('Bazı model gruplarında emsal sayısı yetersiz; o ilanların piyasa konumu hesaplanmadı.');
  if (main.some((r) => r.verdict !== 'risky') && ranked.some((r) => r.damageEvidence === 'none')) {
    warnings.push('Bazı ilanlarda hasar/tramer bilgisi yok (yalnızca arama satırı içe aktarılmış); detay sayfaları kaydedildikçe sıralama keskinleşir.');
  }

  return { ranked, avoid, groups, considered: cands.length, excluded, warnings };
}
