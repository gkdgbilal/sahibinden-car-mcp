import { foldTr } from '../sahibinden/normalize.js';
import type { Listing } from '../sahibinden/types.js';
import { damageGroupOf, tramerBucketOf } from './market.js';
import type { DamageGroup } from './market.js';
import type { RecordView } from '../store/schema.js';

// İlan başına risk bayrakları (saf; saat parametre, I/O yok). Bayrak = "dikkat edilecek nokta", kesin hüküm değildir:
// hasar/tramer/açıklama satıcı beyanıdır; ekspertiz ve tramer sorgusu yerini tutmaz.

export type Severity = 'high' | 'medium' | 'low';

export interface RiskFlag {
  code: string;
  severity: Severity;
  text: string;
}

export interface RiskAssessment {
  flags: RiskFlag[];
  /** Olumlu işaretler (satıcı beyanı; doğrulanmadı). */
  positives: string[];
  damageGroup: DamageGroup;
  /** Hasar bilgisinin kaynağı: detay sayfası, arama URL filtresi ya da yok. */
  damageEvidence: 'detail' | 'search-filter' | 'none';
  tramer: string | null;
}

interface PhraseRule {
  code: string;
  severity: Severity;
  /** foldTr ile katlanmış (ascii, küçük harf) metinde aranır. */
  re: RegExp;
  text: string;
  /** true: kalıbın kendisi olumsuz bir ifade içerir ("muayenesi yok"); genel olumsuzlama filtresi uygulanmaz. */
  selfNegated?: boolean;
}

// Açıklama kalıpları. Cümle olumsuzlama içeriyorsa ("pert değil", "ağır hasar kaydı yok") atlanır.
const PHRASES: readonly PhraseRule[] = [
  { code: 'pert', severity: 'high', re: /\bpert\b/, text: 'Açıklamada "pert" geçiyor' },
  { code: 'heavy-damage-text', severity: 'high', re: /agir hasar/, text: 'Açıklamada "ağır hasar" geçiyor' },
  { code: 'chassis', severity: 'high', re: /\bsasi\b.{0,20}\b(hasar|kaynak|egri|kaza)|\b(hasar|kaynak|egri)\w*\b.{0,15}\bsasi\b/, text: 'Şasi hasarı/kaynağı ima ediliyor' },
  { code: 'engine-fault', severity: 'high', re: /\bmotor\w*\b.{0,15}\b(arizali|sorunlu|bitik|yanik|patlak|catlak|calismiyor)/, text: 'Motor arızası ima ediliyor' },
  { code: 'gearbox-fault', severity: 'high', re: /\b(sanziman|vites kutusu)\w*\b.{0,15}\b(arizali|sorunlu|bitik|atlama|vurma)/, text: 'Şanzıman/vites sorunu ima ediliyor' },
  { code: 'airbag', severity: 'high', re: /airbag\w*\b.{0,15}\b(patlak|patlamis|acilmis|acildi|patladi)|\bhava yastigi\b.{0,15}\b(patlak|patlamis|acilmis)/, text: 'Hava yastığı açılmış/patlak olabilir' },
  { code: 'not-running', severity: 'high', re: /\b(yurumez|calismaz|calismiyor|calismayan|hurda belgeli|hurdaya ayrilmis)\b/, text: 'Araç çalışmıyor/hurda ima ediliyor' },
  { code: 'fire-flood', severity: 'high', re: /\b(yangin gecirmis|yanmis|sel basmis|su basmis|sel hasarli|su hasarli)\b/, text: 'Yangın/sel-su hasarı ima ediliyor' },
  { code: 'odometer', severity: 'high', re: /\b(km|kilometre)\w*\b.{0,15}\b(dusurulmus|degistirilmis|sifirlanmis|geri alinmis)/, text: 'Kilometre müdahalesi ima ediliyor' },
  { code: 'no-notary', severity: 'high', re: /noter satisi (yok|yapilmaz|yapilamaz)|noter(e)? (gelmiyor|gidilmez)/, text: 'Noter satışı yapılmayacağı ima ediliyor', selfNegated: true },
  { code: 'power-of-attorney', severity: 'medium', re: /\b(vekaletname|vekaletle satis|vekalet ile)\b/, text: 'Satış vekaletnameyle: mal sahibi ve tapu/ruhsat sahibini doğrulayın' },
  { code: 'plate', severity: 'medium', re: /\b(plakasiz|plaka satilik|plaka degisikligi|plaka degisti)\b/, text: 'Plaka durumu belirsiz' },
  { code: 'fault-exists', severity: 'medium', re: /\b(ariza|sorun|problem)\w*\b.{0,12}\b(var|mevcut)\b|\b(yag|su) (yakiyor|yapiyor|kaciriyor|eksiltiyor)\b|\bturbo\w*\b.{0,12}\b(sorun|ariza|problem)/, text: 'Bilinen arıza/sorun belirtiliyor' },
  { code: 'needs-work', severity: 'medium', re: /\b(masraf|bakim|tamir|onarim|yedek parca)\w*\b.{0,15}\b(gerekir|gerektirir|ister|gerekiyor|lazim|bekliyor)/, text: 'Masraf/bakım gerektirdiği belirtiliyor' },
  { code: 'inspection', severity: 'medium', re: /\b(muayene\w*|sigorta\w*|kasko\w*)\b.{0,12}\b(yok|gecmis|bitmis|bitti|yoktur)\b/, text: 'Muayene/sigorta durumu sorunlu olabilir', selfNegated: true },
  { code: 'lien', severity: 'medium', re: /\b(icra|haciz|rehin|borc yuzunden|borc nedeniyle)\b/, text: 'İcra/haciz/rehin ya da borç nedeniyle satış ima ediliyor' },
  { code: 'urgent', severity: 'low', re: /\b(acil satilik|acil satilir|acil nakit|acil para|acilen satilik)\b/, text: 'Acil satış vurgusu (pazarlık payı olabilir, nedeni sorun)' },
  { code: 'commercial', severity: 'low', re: /\b(taksi|ticari kullanim|filo arac|kiralik arac|kiralama)\b/, text: 'Taksi/ticari/filo kullanımı geçiyor (yıpranma yüksek olabilir)' },
  { code: 'import', severity: 'low', re: /\b(yurt disi|yurtdisi) (plakali|cikisli|arac)/, text: 'Yurt dışı kökenli olabilir' },
];

const POSITIVES: readonly { re: RegExp; text: string }[] = [
  { re: /\b(ilk sahib\w*|tek sahib\w*|ilk elden)\b/, text: 'Tek/ilk sahip beyanı' },
  { re: /\bbakimlar\w*\b.{0,20}\b(yetkili|serviste|zamaninda|duzenli)|\b(yetkili servis|duzenli bakim|servis bakimli)\b/, text: 'Düzenli/yetkili servis bakımı beyanı' },
  { re: /\bekspertiz\w*\b.{0,15}\b(yaptirilabilir|yapilabilir|raporu|raporlu|serbest)/, text: 'Ekspertize açık/raporlu' },
  { re: /\bgarantisi\w*\b.{0,12}\b(devam|var|suruyor)/, text: 'Garanti devam ediyor beyanı' },
  { re: /\b(hasar kaydi yok|tramer kaydi yok|hatasiz|boyasiz|degisensiz)\b/, text: 'Hasar/tramer yok beyanı (doğrulanmadı)' },
];

const NEGATION = /\b(yok|yoktur|degil|degildir|olmayan|bulunmamaktadir|bulunmuyor|bulunmaz|sorunsuz|problemsiz|arizasiz|yaptirilmamistir|gecirmemistir|gecirmedi)\b/;

/** Açıklamayı cümlelere bölüp kalıpları arar; olumsuzlamalı cümleler atlanır. Katlanmış metin üzerinde çalışır. */
export function scanDescription(description: string | null | undefined): { flags: RiskFlag[]; positives: string[] } {
  const flags: RiskFlag[] = [];
  const positives: string[] = [];
  if (!description) return { flags, positives };
  const sentences = foldTr(description)
    .split(/[.!?\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const s of sentences) {
    const negated = NEGATION.test(s);
    for (const rule of PHRASES) {
      if (negated && !rule.selfNegated) continue;
      if (!seen.has(rule.code) && rule.re.test(s)) {
        seen.add(rule.code);
        flags.push({ code: rule.code, severity: rule.severity, text: rule.text });
      }
    }
    for (const p of POSITIVES) if (!positives.includes(p.text) && p.re.test(s)) positives.push(p.text);
  }
  return { flags, positives };
}

const STRUCTURAL = ['tavan', 'sasi', 'podye', 'direk', 'sac', 'lonjeron', 'marspiyel'];

/**
 * Bir kayıt için risk bayrakları. Hasar grubu `damageGroupOf` ile (detay > arama filtresi), tramer detay sayfasından,
 * yıllık km makul aralıkla, açıklama kalıplarla değerlendirilir. Bilgi yoksa "bilinmiyor" bayrağı (low) eklenir.
 */
export function assessRisk(view: RecordView, now: Date, maxAgeDays: number): RiskAssessment {
  const flags: RiskFlag[] = [];
  const b = view.best as Partial<Listing> & RecordView['best'];
  const dmg = damageGroupOf(view, now, maxAgeDays);
  const tramer = tramerBucketOf(view);

  switch (dmg.group) {
    case 'heavy':
      flags.push({ code: 'heavy-damage', severity: 'high', text: 'Ağır hasar kaydı var' });
      break;
    case 'replaced': {
      const changed = (b.damage ?? []).filter((p) => p.status === 'changed');
      const structural = changed.some((p) => STRUCTURAL.some((s) => foldTr(p.part).includes(s)));
      flags.push({
        code: 'replaced-parts',
        severity: structural || changed.length >= 3 ? 'high' : 'medium',
        text: `Değişen parça: ${changed.map((p) => p.part).join(', ')}`,
      });
      break;
    }
    case 'painted': {
      const painted = (b.damage ?? []).filter((p) => p.status === 'painted' || p.status === 'local-painted');
      flags.push({
        code: 'painted-parts',
        severity: painted.length >= 4 ? 'medium' : 'low',
        text: `Boyalı/lokal boyalı parça: ${painted.map((p) => p.part).join(', ')}`,
      });
      break;
    }
    case 'unknown':
      flags.push({ code: 'damage-unknown', severity: 'low', text: 'Hasar/boya/değişen bilgisi yok (detay sayfası içe aktarılmadı)' });
      break;
    case 'clean':
      break;
  }
  if (dmg.conflict) {
    flags.push({ code: 'evidence-conflict', severity: 'medium', text: 'Arama filtresi "hatasız" diyor, ilan detayı hasar gösteriyor (detay geçerli)' });
  }

  if (tramer === '>100 bin') flags.push({ code: 'tramer-high', severity: 'high', text: 'Tramer 100 bin TL üzerinde (satıcı beyanı)' });
  else if (tramer === '25–100 bin') flags.push({ code: 'tramer-mid', severity: 'medium', text: 'Tramer 25–100 bin TL arası (satıcı beyanı)' });
  else if (tramer === '≤25 bin') flags.push({ code: 'tramer-low', severity: 'low', text: 'Küçük tutarlı tramer (satıcı beyanı)' });
  else if (tramer === 'mentioned') flags.push({ code: 'tramer-mentioned', severity: 'medium', text: 'Açıklamada tramer/çarpma geçiyor, tutar belirtilmemiş' });

  // Yıllık km: yaşa göre makul aralık dışı olabilir; kesin değil, doğrulama ister.
  if (b.year && b.km !== null && b.km !== undefined) {
    const age = Math.max(1, now.getUTCFullYear() - b.year);
    const perYear = b.km / age;
    if (age >= 3 && perYear < 5_000) {
      flags.push({ code: 'km-low', severity: 'medium', text: `Yıllık km çok düşük (~${Math.round(perYear).toLocaleString('tr-TR')} km/yıl); servis kayıtlarıyla doğrulayın` });
    } else if (perYear > 35_000) {
      flags.push({ code: 'km-high', severity: 'low', text: `Yıllık km yüksek (~${Math.round(perYear).toLocaleString('tr-TR')} km/yıl)` });
    }
  }

  const scan = scanDescription(b.description);
  flags.push(...scan.flags);

  return { flags, positives: scan.positives, damageGroup: dmg.group, damageEvidence: dmg.evidence, tramer };
}
