import { warehouseCountry } from '../domain/warehouse.js';
import type {
  CatalogListing, CatalogPage, Country, Fee, PriceStock, ProductDetails, QuantityBreak, SpecialPricing, WarehouseStock,
} from '../domain/types.js';

// Turns Ingram responses into the normalized shapes. Ingram is loose with types (booleans arrive
// as "true"/"false" strings, warehouse IDs as numbers or strings), so every field is coerced.

const EHF_PATTERN = /\bEHF\b|ENVIRO|ECO[ -]?FEE|RECYCL|HANDLING FEE/i;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function bool(v: unknown): boolean {
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number {
  return Math.trunc(num(v) ?? 0);
}

export function parseSearchItem(item: any): CatalogListing {
  return {
    distributor: 'ingram',
    distributorSku: String(item.ingramPartNumber).trim(),
    manufacturerRaw: str(item.vendorName) ?? '',
    mpnRaw: str(item.vendorPartNumber),
    upc: str(item.upcCode),
    title: [str(item.description), str(item.extraDescription)].filter(Boolean).join(' ').replace(/\s+/g, ' '),
    distributorCategory: str(item.category),
    distributorSubcategory: str(item.subCategory),
    discontinued: bool(item.discontinued),
    // Missing means we weren't told otherwise.
    authorizedToPurchase: item.authorizedToPurchase === undefined ? true : bool(item.authorizedToPurchase),
    directShip: bool(item.directShip),
    newProduct: bool(item.newProduct),
    raw: item,
  };
}

export function parseSearchPage(body: any, requestedPage: number, pageSize: number): CatalogPage {
  const items: any[] = Array.isArray(body?.catalog) ? body.catalog : [];
  const listings = items.filter((i) => i?.ingramPartNumber).map(parseSearchItem);
  const pageNumber = int(body?.pageNumber) || requestedPage;
  const total = num(body?.recordsFound);
  const isLastPage =
    items.length === 0 || items.length < pageSize || (total !== null && pageNumber * pageSize >= total) || !body?.nextPage;
  return { pageNumber, totalRecords: total, listings, isLastPage };
}

function parseFees(fees: any): Fee[] {
  if (!Array.isArray(fees)) return [];
  return fees
    .map((f): Fee | null => {
      const amount = num(f?.amount);
      if (amount === null) return null;
      const code = str(f.conditionType);
      const description = str(f.description);
      return {
        code, description, amount, currency: str(f.currencyCode),
        isEhf: EHF_PATTERN.test(`${code ?? ''} ${description ?? ''}`),
      };
    })
    .filter((f): f is Fee => f !== null);
}

function parseDiscounts(discounts: any): { quantityBreaks: QuantityBreak[]; specialPricing: SpecialPricing[] } {
  const quantityBreaks: QuantityBreak[] = [];
  const specialPricing: SpecialPricing[] = [];
  for (const d of Array.isArray(discounts) ? discounts : []) {
    for (const q of Array.isArray(d?.quantityDiscounts) ? d.quantityDiscounts : []) {
      const amount = num(q?.amount);
      const minQuantity = num(q?.quantity);
      // The spec's example carries placeholder zeros; a break needs a real quantity and amount.
      if (amount === null || !minQuantity || amount <= 0) continue;
      quantityBreaks.push({ minQuantity, amount, currency: str(q.currencyCode), conditionType: str(q.conditionType) });
    }
    for (const s of Array.isArray(d?.specialPricing) ? d.specialPricing : []) {
      specialPricing.push({
        type: str(s?.discountType),
        // The spec spells it both ways.
        bidNumber: str(s?.specialBidNumber ?? s?.specialBidNumer),
        discount: num(s?.specialPricingDiscount),
        effectiveDate: str(s?.specialPricingEffectiveDate),
        expirationDate: str(s?.specialPricingExpirationDate),
        minQuantity: num(s?.specialPricingMinQuantity),
        availableQuantity: num(s?.specialPricingAvailableQuantity),
      });
    }
  }
  quantityBreaks.sort((a, b) => a.minQuantity - b.minQuantity);
  return { quantityBreaks, specialPricing };
}

function parseStock(availability: any, overrides: Record<string, Country>): WarehouseStock[] {
  const rows: any[] = Array.isArray(availability?.availabilityByWarehouse) ? availability.availabilityByWarehouse : [];
  return rows
    .filter((w) => w?.warehouseId != null)
    .map((w) => {
      const warehouseId = String(w.warehouseId).trim();
      const location = str(w.location);
      const etas: { quantity: number; etaDate: string }[] = [];
      for (const b of Array.isArray(w.backOrderInfo) ? w.backOrderInfo : []) {
        if (b?.etaDate) etas.push({ quantity: int(b.quantity), etaDate: String(b.etaDate) });
      }
      if (etas.length === 0 && w.quantityBackorderedEta) etas.push({ quantity: int(w.quantityBackordered), etaDate: String(w.quantityBackorderedEta) });
      return {
        warehouseId,
        location,
        country: warehouseCountry(warehouseId, location, overrides),
        quantityAvailable: int(w.quantityAvailable),
        quantityBackordered: int(w.quantityBackordered),
        quantityOnOrder: int(w.quantityOnOrder),
        backorderEtas: etas,
      };
    });
}

/**
 * Specs as name → value. The spec documents no attribute field on price & availability even
 * though includeProductAttributes exists, so accept the shapes Ingram uses elsewhere.
 */
export function parseSpecs(item: any): Record<string, string> {
  const specs: Record<string, string> = {};
  const lists = [item?.productAttributes, item?.attributes, item?.technicalSpecifications, item?.productAttributes?.attributes];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      const name = str(a?.attributeName ?? a?.attributename ?? a?.name);
      const value = str(a?.attributeValue ?? a?.attributevalue ?? a?.value);
      if (name && value && !(name in specs)) specs[name] = value;
    }
  }
  return specs;
}

export function parsePriceAndAvailability(body: any, overrides: Record<string, Country> = {}): PriceStock[] {
  const items: any[] = Array.isArray(body) ? body : Array.isArray(body?.products) ? body.products : [];
  return items.map((item): PriceStock => {
    const sku = String(item?.ingramPartNumber ?? '').trim();
    const statusCode = str(item?.productStatusCode);
    if (statusCode === 'E') {
      return { ok: false, distributorSku: sku, error: str(item.productStatusMessage) ?? 'Product error', raw: item };
    }
    // The spec's 207 example nests pricing inside availability; accept either place.
    const pricing = item?.pricing ?? item?.availability?.pricing ?? {};
    const fees = parseFees(item?.serviceFees);
    const ehfFees = fees.filter((f) => f.isEhf);
    return {
      ok: true,
      distributorSku: sku,
      cost: num(pricing.customerPrice),
      msrp: num(pricing.retailPrice),
      mapPrice: num(pricing.mapPrice),
      currency: str(pricing.currencyCode),
      ehf: ehfFees.length ? ehfFees.reduce((sum, f) => sum + f.amount, 0) : null,
      fees,
      ...parseDiscounts(item?.discounts),
      stock: parseStock(item?.availability, overrides),
      specs: parseSpecs(item),
      raw: item,
    };
  });
}

export function parseDetails(body: any): ProductDetails {
  const images: string[] = [];
  for (const key of ['images', 'productImages', 'imageUrls']) {
    for (const i of Array.isArray(body?.[key]) ? body[key] : []) {
      const url = typeof i === 'string' ? i : str(i?.url ?? i?.imageUrl ?? i?.href);
      if (url) images.push(url);
    }
  }
  return {
    distributorSku: String(body?.ingramPartNumber ?? '').trim(),
    longDescription: str(body?.productDetailDescription),
    specs: parseSpecs(body),
    imageUrls: images,
    isRefurbished: bool(body?.indicators?.isRefurbished),
    raw: body,
  };
}
