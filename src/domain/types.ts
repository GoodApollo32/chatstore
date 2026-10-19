// The normalized shape every distributor connector produces. Ingram is the only connector in
// Phase 1; TD Synnex and D&H will emit the same shapes so the jobs and database don't change.

export type DistributorId = 'ingram' | 'td_synnex' | 'dh';

export type Country = 'CA' | 'US';

/** One product as it appears in a distributor's catalog search (no price or stock yet). */
export interface CatalogListing {
  distributor: DistributorId;
  distributorSku: string;
  manufacturerRaw: string;
  mpnRaw: string | null;
  upc: string | null;
  title: string;
  distributorCategory: string | null;
  distributorSubcategory: string | null;
  discontinued: boolean;
  authorizedToPurchase: boolean;
  directShip: boolean;
  newProduct: boolean;
  raw: unknown;
}

export interface Fee {
  code: string | null;
  description: string | null;
  amount: number;
  currency: string | null;
  isEhf: boolean;
}

export interface QuantityBreak {
  minQuantity: number;
  amount: number;
  currency: string | null;
  conditionType: string | null;
}

export interface SpecialPricing {
  type: string | null;
  bidNumber: string | null;
  discount: number | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  minQuantity: number | null;
  availableQuantity: number | null;
}

export interface WarehouseStock {
  warehouseId: string;
  location: string | null;
  country: Country | null;
  quantityAvailable: number;
  quantityBackordered: number;
  quantityOnOrder: number;
  backorderEtas: { quantity: number; etaDate: string }[];
}

/** Result of a price & stock check for one distributor SKU. */
export type PriceStock =
  | {
      ok: true;
      distributorSku: string;
      cost: number | null;
      msrp: number | null;
      mapPrice: number | null;
      currency: string | null;
      /** Total EHF per unit, null when the distributor reported none. */
      ehf: number | null;
      fees: Fee[];
      quantityBreaks: QuantityBreak[];
      specialPricing: SpecialPricing[];
      stock: WarehouseStock[];
      specs: Record<string, string>;
      raw: unknown;
    }
  | { ok: false; distributorSku: string; error: string; raw: unknown };

export interface ProductDetails {
  distributorSku: string;
  longDescription: string | null;
  specs: Record<string, string>;
  imageUrls: string[];
  isRefurbished: boolean;
  raw: unknown;
}

export interface CatalogPage {
  pageNumber: number;
  totalRecords: number | null;
  listings: CatalogListing[];
  isLastPage: boolean;
}

export interface DistributorConnector {
  readonly id: DistributorId;
  /** Pages through the catalog for one manufacturer, starting at startPage (for resuming). */
  catalogPages(searchTerm: string, startPage: number): AsyncIterable<CatalogPage>;
  /** Price & stock for up to `priceStockBatchSize` SKUs per call. */
  readonly priceStockBatchSize: number;
  priceAndStock(skus: string[], opts?: { includeSpecs?: boolean }): Promise<PriceStock[]>;
  /** Product details where the distributor offers them; throws DetailsUnavailableError otherwise. */
  details?(sku: string): Promise<ProductDetails>;
}

export class DetailsUnavailableError extends Error {}
