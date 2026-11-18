import { foldTr } from './normalize.js';
import type {
  BodyType, Color, Drivetrain, EnginePower, EngineVolume, Fuel, ListedWithin, PriceCurrency, SellerType, Sort,
  Transmission, VehicleCondition,
} from './types.js';

// Tüm URL sabitleri burada. Ayrıntı ve doğrulama kaydı: docs/04-URL-SCHEMA.md.
// `verified:true` = 2026-11-18'de kullanıcının kendi Chrome oturumunda gerçek sahibinden sayfasından,
// sitenin kendi filtre bağlantılarından okundu. `verified:false` = varsayım, canlı sitede doğrulanmadı.
export const BASE = 'https://www.sahibinden.com';
export const VERIFIED_ON = '2026-11-18';

export const PARAMS = {
  priceMin: { key: 'price_min', verified: true },
  priceMax: { key: 'price_max', verified: true },
  priceCurrency: { key: 'price_currency', verified: true },
  yearMin: { key: 'a5_min', verified: true },
  yearMax: { key: 'a5_max', verified: true },
  kmMin: { key: 'a4_min', verified: true },
  kmMax: { key: 'a4_max', verified: true },
  transmission: { key: 'a6', verified: true },
  fuel: { key: 'a17', verified: true },
  sellerType: { key: 'a706', verified: true },
  bodyType: { key: 'a8', verified: true },
  color: { key: 'a3', verified: true },
  vehicleCondition: { key: 'a113987', verified: true },
  enginePower: { key: 'a2320', verified: true },
  engineVolume: { key: 'a1864', verified: true },
  drivetrain: { key: 'a9213', verified: true },
  exchange: { key: 'exchange', verified: true },
  listedWithin: { key: 'date', verified: true },
  unpainted: { key: 'unpaintedParts', verified: true },
  noReplacedParts: { key: 'unchangingTracks', verified: true },
  heavyDamage: { key: 'a116445', verified: true }, // Ağır Hasar Kayıtlı: 1263353 Evet, 1263354 Hayır
  warranty: { key: 'a4054', verified: true }, // Servis Garantisi: 72906 Evet, 72907 Hayır
  sorting: { key: 'sorting', verified: true },
  // Parametre doğrulandı; plaka kodları yalnızca CITIES içinde işaretli şehirler için doğrulandı.
  city: { key: 'address_city', verified: true },
  pagingOffset: { key: 'pagingOffset', verified: true },
} as const;

/** Sayfa başına ilan sayısı (pagingOffset = (sayfa-1) * PAGE_SIZE). */
export const PAGE_SIZE = 20;

export const PRICE_CURRENCY_IDS: Partial<Record<PriceCurrency, string>> = { USD: '2', EUR: '3', GBP: '4' }; // TL: parametre yok

// Vites: yarı otomatik için kimlik bilinmiyor -> URL'e eklenmez, not düşülür.
export const TRANSMISSION_IDS: Partial<Record<Transmission, string>> = { manual: '32467', automatic: '32466' };

// Yakıt: "hybrid" -> Benzin(Hibrit). Diğer hibrit türleri için aşağıdaki HYBRID_VARIANT_IDS.
export const FUEL_IDS: Record<Fuel, string> = {
  gasoline: '21', diesel: '22', lpg: '50276', electric: '1202111', hybrid: '1312756',
};
export const HYBRID_VARIANT_IDS = {
  'Benzin(Hibrit)': '1312756',
  'Benzin(Plug-in Hibrit)': '1312757',
  'Benzin(Hafif Hibrit)': '1312755',
  'Dizel(Hafif Hibrit)': '1312754',
} as const;

export const SELLER_TYPE_IDS: Record<SellerType, string> = {
  owner: '32474', dealer: '32475', 'authorized-dealer': '1160380',
};

export const BODY_TYPE_IDS: Record<BodyType, string> = {
  cabrio: '240', coupe: '48626', 'coupe-4-door': '1263542', 'hatchback-3-door': '20',
  'hatchback-5-door': '62068', sedan: '250', 'station-wagon': '19', mpv: '1197465', roadster: '1197466',
};

export const COLOR_IDS: Record<Color, string> = {
  beige: '655354', white: '33611', burgundy: '33617', 'smoke-gray': '658878', gray: '33612',
  'silver-gray': '40948', brown: '33621', red: '33613', navy: '33615', blue: '33610', purple: '33624', pink: '40167',
  yellow: '33614', black: '33616', champagne: '675106', turquoise: '44926', orange: '40148', green: '33618',
};

export const VEHICLE_CONDITION_IDS: Record<VehicleCondition, string> = {
  'second-hand': '1252385', 'imported-new': '1252386', new: '1252387',
};

// a2320 = motor gücü aralığı kimlikleri (a17 yakıt kimlikleriyle karıştırma).
export const ENGINE_POWER_IDS: Record<EnginePower, string> = {
  'upto-50': '1096156', '51-75': '1096158', '76-100': '74344', '101-125': '74345',
  '126-150': '74346', '151-175': '74347', '176-200': '74348', '201-225': '74349',
  '226-250': '74350', '251-275': '74351', '276-300': '74352', '301-325': '74353', '326-350': '74354',
  '351-375': '74355', '376-400': '74356', '401-425': '74357', '426-450': '74358', '451-475': '74359',
  '476-500': '74360', '501-525': '74361', '526-550': '74362', '551-575': '74363', '576-600': '74364',
  '601-up': '74365', // "601 HP ve üzeri"
};

export const ENGINE_VOLUME_IDS: Record<EngineVolume, string> = {
  'upto-1300': '51977', '1301-1600': '1118042', '1601-1800': '51979', '1801-2000': '51980', '2001-2500': '51981',
  '2501-3000': '51982', '3001-3500': '51983', '3501-4000': '51984', '4001-4500': '51985',
  '4501-5000': '74366', '5001-5500': '74367',
  '5501-6000': '74368', '6001-up': '74369', // "6001 cc ve üzeri"
};

export interface NumericRange {
  /** Alt sınır (dahil değil); "upto-N" için -Infinity. */
  lo: number;
  /** Üst sınır (dahil); "... ve üzeri" için +Infinity. */
  hi: number;
}

/** "upto-1300" -> (-inf,1300]; "1301-1600" -> (1300,1600]; "601-up" -> (600,+inf). Etiketler yukarıdaki kimlik tablolarının anahtarlarıdır. */
function rangesFromKeys<K extends string>(keys: readonly K[]): Record<K, NumericRange> {
  const out = {} as Record<K, NumericRange>;
  for (const k of keys) {
    const up = /^upto-(\d+)$/.exec(k);
    const open = /^(\d+)-up$/.exec(k);
    const mid = /^(\d+)-(\d+)$/.exec(k);
    if (up) out[k] = { lo: -Infinity, hi: Number(up[1]) };
    else if (open) out[k] = { lo: Number(open[1]) - 1, hi: Infinity };
    else if (mid) out[k] = { lo: Number(mid[1]) - 1, hi: Number(mid[2]) };
    else throw new Error(`Aralık anahtarı tanınmadı: ${k}`);
  }
  return out;
}

/** Yerel filtre için sayısal aralıklar (a2320, hp). */
export const ENGINE_POWER_RANGES = rangesFromKeys(Object.keys(ENGINE_POWER_IDS) as EnginePower[]);
/** Yerel filtre için sayısal aralıklar (a1864, cc). */
export const ENGINE_VOLUME_RANGES = rangesFromKeys(Object.keys(ENGINE_VOLUME_IDS) as EngineVolume[]);

/** listedWithin -> gün sayısı (yerel filtre). */
export const LISTED_WITHIN_DAYS: Record<ListedWithin, number> = {
  '1day': 1, '3days': 3, '7days': 7, '15days': 15, '30days': 30,
};

export const DRIVETRAIN_IDS: Record<Drivetrain, string> = { fwd: '136269', rwd: '136270', '4wd': '136271', awd: '136272' };

export const LISTED_WITHIN_VALUES: Record<ListedWithin, string> = {
  '1day': '1day', '3days': '3days', '7days': '7days', '15days': '15days', '30days': '30days',
};

export const HEAVY_DAMAGE_IDS = { yes: '1263353', no: '1263354' } as const;
export const WARRANTY_IDS = { yes: '72906', no: '72907' } as const;

export const SORTING_VALUES: Record<Sort, string> = {
  price_asc: 'price_asc', price_desc: 'price_desc',
  date_desc: 'date_desc', date_asc: 'date_asc',
  km_asc: 'km-nu_asc', km_desc: 'km-nu_desc',
  year_asc: 'yil-nu_asc', year_desc: 'yil-nu_desc',
};

export interface CityEntry {
  code: number;
  name: string;
  /** true = `address_city={code}` canlı sitede doğrulandı; false = plaka kodu varsayımı. */
  verified: boolean;
}

const city = (code: number, name: string): CityEntry => ({ code, name, verified: code === 55 || code === 34 });

/** 81 il, plaka koduyla. Yalnızca Samsun (55) ve İstanbul (34) doğrulandı. */
export const CITIES: readonly CityEntry[] = [
  city(1, 'Adana'), city(2, 'Adıyaman'), city(3, 'Afyonkarahisar'), city(4, 'Ağrı'), city(5, 'Amasya'),
  city(6, 'Ankara'), city(7, 'Antalya'), city(8, 'Artvin'), city(9, 'Aydın'), city(10, 'Balıkesir'),
  city(11, 'Bilecik'), city(12, 'Bingöl'), city(13, 'Bitlis'), city(14, 'Bolu'), city(15, 'Burdur'),
  city(16, 'Bursa'), city(17, 'Çanakkale'), city(18, 'Çankırı'), city(19, 'Çorum'), city(20, 'Denizli'),
  city(21, 'Diyarbakır'), city(22, 'Edirne'), city(23, 'Elazığ'), city(24, 'Erzincan'), city(25, 'Erzurum'),
  city(26, 'Eskişehir'), city(27, 'Gaziantep'), city(28, 'Giresun'), city(29, 'Gümüşhane'), city(30, 'Hakkâri'),
  city(31, 'Hatay'), city(32, 'Isparta'), city(33, 'Mersin'), city(34, 'İstanbul'), city(35, 'İzmir'),
  city(36, 'Kars'), city(37, 'Kastamonu'), city(38, 'Kayseri'), city(39, 'Kırklareli'), city(40, 'Kırşehir'),
  city(41, 'Kocaeli'), city(42, 'Konya'), city(43, 'Kütahya'), city(44, 'Malatya'), city(45, 'Manisa'),
  city(46, 'Kahramanmaraş'), city(47, 'Mardin'), city(48, 'Muğla'), city(49, 'Muş'), city(50, 'Nevşehir'),
  city(51, 'Niğde'), city(52, 'Ordu'), city(53, 'Rize'), city(54, 'Sakarya'), city(55, 'Samsun'),
  city(56, 'Siirt'), city(57, 'Sinop'), city(58, 'Sivas'), city(59, 'Tekirdağ'), city(60, 'Tokat'),
  city(61, 'Trabzon'), city(62, 'Tunceli'), city(63, 'Şanlıurfa'), city(64, 'Uşak'), city(65, 'Van'),
  city(66, 'Yozgat'), city(67, 'Zonguldak'), city(68, 'Aksaray'), city(69, 'Bayburt'), city(70, 'Karaman'),
  city(71, 'Kırıkkale'), city(72, 'Batman'), city(73, 'Şırnak'), city(74, 'Bartın'), city(75, 'Ardahan'),
  city(76, 'Iğdır'), city(77, 'Yalova'), city(78, 'Karabük'), city(79, 'Kilis'), city(80, 'Osmaniye'),
  city(81, 'Düzce'),
];

/** Yaygın kısa/eski adlar (foldTr anahtarı -> plaka kodu). */
const CITY_ALIASES: Record<string, number> = {
  afyon: 3, icel: 33, maras: 46, 'k.maras': 46, urfa: 63, antep: 27,
};

const CITY_BY_KEY = new Map<string, CityEntry>();
for (const c of CITIES) CITY_BY_KEY.set(foldTr(c.name), c);
for (const [alias, code] of Object.entries(CITY_ALIASES)) {
  const c = CITIES.find((x) => x.code === code);
  if (c && !CITY_BY_KEY.has(alias)) CITY_BY_KEY.set(alias, c);
}

/** Şehir adı (Türkçe katlamalı: "izmir"/"İZMİR"/"Izmir") ya da plaka kodu -> il kaydı; bilinmiyorsa undefined. */
export function resolveCity(input: string | null | undefined): CityEntry | undefined {
  const key = foldTr(input);
  if (!key) return undefined;
  if (/^\d{1,2}$/.test(key)) return CITIES.find((c) => c.code === Number(key));
  return CITY_BY_KEY.get(key);
}

/** Yol parçası olarak şehir slug'ı ("istanbul", "afyonkarahisar"); katlanmış addan türetilir. */
export function citySlug(c: CityEntry): string {
  return foldTr(c.name).replace(/[^a-z0-9]+/g, '-');
}

export const LISTING_URL = (id: string) => `${BASE}/ilan/${id}/detay`; // fallback; gerçek slug'lı URL tercih
