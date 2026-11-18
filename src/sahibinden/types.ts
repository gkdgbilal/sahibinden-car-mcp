import { z } from 'zod';

export const CurrencySchema = z.enum(['TL', 'USD', 'EUR']);
export const TransmissionSchema = z.enum(['manual', 'automatic', 'semi-automatic']);
export const FuelSchema = z.enum(['gasoline', 'diesel', 'lpg', 'hybrid', 'electric']);
export const SellerTypeSchema = z.enum(['owner', 'dealer', 'authorized-dealer']);
export const PartStatusSchema = z.enum(['original', 'painted', 'local-painted', 'changed']);

// Hem sahibinden arama URL'sine hem yerel mağaza filtresine uygulanan değerler (doğrulanmış kimlikler: url-schema.ts).
export const BodyTypeSchema = z.enum([
  'cabrio', 'coupe', 'coupe-4-door', 'hatchback-3-door', 'hatchback-5-door', 'sedan', 'station-wagon', 'mpv', 'roadster',
]);
export const ColorSchema = z.enum([
  'beige', 'white', 'burgundy', 'smoke-gray', 'gray', 'silver-gray', 'brown', 'red', 'navy', 'blue', 'purple', 'pink',
  'yellow', 'black', 'champagne', 'turquoise', 'orange', 'green',
]);
export const VehicleConditionSchema = z.enum(['second-hand', 'imported-new', 'new']);
export const EnginePowerSchema = z.enum([
  'upto-50', '51-75', '76-100', '101-125', '126-150', '151-175', '176-200', '201-225', '226-250', '251-275',
  '276-300', '301-325', '326-350', '351-375', '376-400', '401-425', '426-450', '451-475', '476-500', '501-525',
  '526-550', '551-575', '576-600', '601-up',
]);
export const EngineVolumeSchema = z.enum([
  'upto-1300', '1301-1600', '1601-1800', '1801-2000', '2001-2500', '5501-6000', '6001-up',
]);
export const DrivetrainSchema = z.enum(['fwd', 'rwd', '4wd', 'awd']);
export const ListedWithinSchema = z.enum(['1day', '3days', '7days', '15days', '30days']);
export const UnknownPolicySchema = z.enum(['include', 'exclude']);
export const PriceCurrencySchema = z.enum(['TL', 'USD', 'EUR', 'GBP']);
export const SortSchema = z.enum([
  'price_asc', 'price_desc', 'year_desc', 'year_asc', 'km_asc', 'km_desc', 'date_desc', 'date_asc',
]);

export type Currency = z.infer<typeof CurrencySchema>;
export type Transmission = z.infer<typeof TransmissionSchema>;
export type Fuel = z.infer<typeof FuelSchema>;
export type SellerType = z.infer<typeof SellerTypeSchema>;
export type PartStatus = z.infer<typeof PartStatusSchema>;
export type BodyType = z.infer<typeof BodyTypeSchema>;
export type Color = z.infer<typeof ColorSchema>;
export type VehicleCondition = z.infer<typeof VehicleConditionSchema>;
export type EnginePower = z.infer<typeof EnginePowerSchema>;
export type EngineVolume = z.infer<typeof EngineVolumeSchema>;
export type Drivetrain = z.infer<typeof DrivetrainSchema>;
export type ListedWithin = z.infer<typeof ListedWithinSchema>;
export type UnknownPolicy = z.infer<typeof UnknownPolicySchema>;
export type PriceCurrency = z.infer<typeof PriceCurrencySchema>;
export type Sort = z.infer<typeof SortSchema>;

export const ListingSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  series: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().nullable(),
  km: z.number().nullable(),
  color: z.string().nullable(),
  price: z.number().nullable(),
  currency: CurrencySchema.nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  /** Şehir filtreli arama sayfasında "İlçe Mahalle" hücresinden; yoksa alan hiç yazılmaz. */
  neighborhood: z.string().nullable().optional(),
  /** Konum hücresinin ham metni; yalnızca il/ilçe ayrımı belirsiz ya da sezgisel olduğunda yazılır. */
  locationRaw: z.string().nullable().optional(),
  listingDate: z.string().nullable(),
  transmission: TransmissionSchema.nullable(),
  fuel: FuelSchema.nullable(),
  source: z.enum(['search', 'listing']),
  capturedAt: z.string(),
});

export const ListingSchema = ListingSummarySchema.extend({
  engine: z
    .object({ volumeCc: z.number().nullable(), powerHp: z.number().nullable() })
    .nullable(),
  bodyType: z.string().nullable(),
  drivetrain: z.string().nullable(),
  vehicleCondition: z.string().nullable(),
  sellerType: SellerTypeSchema.nullable(),
  exchange: z.boolean().nullable(),
  warranty: z.boolean().nullable(),
  heavyDamage: z.boolean().nullable(),
  tramerAmount: z.number().nullable(),
  damage: z.array(z.object({ part: z.string(), status: PartStatusSchema })).nullable(),
  description: z.string().nullable(),
  attributes: z.record(z.string(), z.string()),
  warnings: z.array(z.string()),
});

export type ListingSummary = z.infer<typeof ListingSummarySchema>;
export type Listing = z.infer<typeof ListingSchema>;

export const SearchQuerySchema = z.object({
  city: z.string().optional(),
  brand: z.string().optional(),
  models: z.array(z.string()).max(10).optional(),
  priceMin: z.number().int().nonnegative().optional(),
  priceMax: z.number().int().positive().optional(),
  transmission: TransmissionSchema.optional(),
  fuel: FuelSchema.optional(),
  yearMin: z.number().int().min(1950).max(2100).optional(),
  yearMax: z.number().int().min(1950).max(2100).optional(),
  kmMin: z.number().int().nonnegative().optional(),
  kmMax: z.number().int().nonnegative().optional(),
  // priceMin/priceMax bu para birimi cinsindendir (varsayılan TL); başka para birimli ilan fiyat filtresiyle elenir.
  priceCurrency: PriceCurrencySchema.optional(),
  sellerType: SellerTypeSchema.optional(),
  bodyType: BodyTypeSchema.optional(),
  color: ColorSchema.optional(),
  vehicleCondition: VehicleConditionSchema.optional(),
  enginePower: EnginePowerSchema.optional(),
  engineVolume: EngineVolumeSchema.optional(),
  drivetrain: DrivetrainSchema.optional(),
  exchange: z.boolean().optional(),
  listedWithin: ListedWithinSchema.optional(),
  unpaintedOnly: z.boolean().optional(),
  noReplacedParts: z.boolean().optional(),
  /** true: yalnızca ağır hasar kaydı olmayanlar (a116445=Hayır). false = filtre yok. */
  noHeavyDamage: z.boolean().optional(),
  /** true: servis garantisi olanlar, false: olmayanlar (a4054). */
  warranty: z.boolean().optional(),
  page: z.number().int().min(1).max(50).optional(),
  sort: SortSchema.default('price_asc'),
  limit: z.number().int().min(1).max(100).default(20),
  /** 'include' (varsayılan): alanı bilinmeyen ilan unknownFields ile işaretli döner; 'exclude': elenir. */
  unknown: UnknownPolicySchema.optional(),
  /** Eski ad; `unknown` verilmediyse onun yerine geçer (false = 'exclude'). */
  includeUnknown: z.boolean().optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export type PageType = 'search' | 'listing' | 'challenge' | 'unknown';

export interface ParseContext {
  capturedAt: string;
  sourceUrl?: string;
  /** Arama sayfası şehir filtreliyse şehir adı (ör. "Samsun"); sayfadan çıkarılan bağlamı geçersiz kılar. */
  cityHint?: string;
}
