import { z } from 'zod';

export const CurrencySchema = z.enum(['TL', 'USD', 'EUR']);
export const TransmissionSchema = z.enum(['manual', 'automatic', 'semi-automatic']);
export const FuelSchema = z.enum(['gasoline', 'diesel', 'lpg', 'hybrid', 'electric']);
export const SellerTypeSchema = z.enum(['owner', 'dealer', 'authorized-dealer']);
export const PartStatusSchema = z.enum(['original', 'painted', 'local-painted', 'changed']);

export type Currency = z.infer<typeof CurrencySchema>;
export type Transmission = z.infer<typeof TransmissionSchema>;
export type Fuel = z.infer<typeof FuelSchema>;
export type SellerType = z.infer<typeof SellerTypeSchema>;
export type PartStatus = z.infer<typeof PartStatusSchema>;

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
  sort: z.enum(['price_asc', 'price_desc', 'year_desc', 'km_asc', 'date_desc']).default('price_asc'),
  limit: z.number().int().min(1).max(100).default(20),
  includeUnknown: z.boolean().default(true),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export type PageType = 'search' | 'listing' | 'challenge' | 'unknown';

export interface ParseContext {
  capturedAt: string;
  sourceUrl?: string;
}
