import type { IngramConfig } from '../config.js';
import { DetailsUnavailableError, type CatalogPage, type Country, type DistributorConnector, type PriceStock, type ProductDetails } from '../domain/types.js';
import { IngramApiError, IngramClient, type ClientOptions } from './client.js';
import { parseDetails, parsePriceAndAvailability, parseSearchPage } from './parse.js';

export const SEARCH_PAGE_SIZE = 100; // Ingram's maximum
const MAX_PAGES = 1000; // safety stop

export class IngramConnector implements DistributorConnector {
  readonly id = 'ingram' as const;
  readonly priceStockBatchSize = 50; // Ingram's maximum per price & availability call
  readonly client: IngramClient;

  constructor(
    config: IngramConfig,
    private readonly warehouseCountries: Record<string, Country> = {},
    clientOptions: ClientOptions = {},
  ) {
    this.client = new IngramClient(config, clientOptions);
  }

  async searchPage(vendor: string, pageNumber: number, pageSize = SEARCH_PAGE_SIZE): Promise<{ page: CatalogPage; raw: unknown }> {
    const { body } = await this.client.get<any>('/resellers/v6/catalog', { vendor, pageNumber, pageSize });
    return { page: parseSearchPage(body, pageNumber, pageSize), raw: body };
  }

  async *catalogPages(vendor: string, startPage: number): AsyncIterable<CatalogPage> {
    for (let pageNumber = startPage; pageNumber < startPage + MAX_PAGES; pageNumber++) {
      const { page } = await this.searchPage(vendor, pageNumber);
      yield page;
      if (page.isLastPage) return;
    }
  }

  async priceAndStockRaw(skus: string[], includeSpecs = false): Promise<{ status: number; body: unknown }> {
    if (skus.length > this.priceStockBatchSize) throw new Error(`At most ${this.priceStockBatchSize} products per call`);
    return this.client.post<unknown>(
      '/resellers/v6/catalog/priceandavailability',
      { includePricing: true, includeAvailability: true, includeProductAttributes: includeSpecs || undefined },
      { products: skus.map((ingramPartNumber) => ({ ingramPartNumber })), showAvailableDiscounts: true },
    );
  }

  async priceAndStock(skus: string[], opts: { includeSpecs?: boolean } = {}): Promise<PriceStock[]> {
    let body: unknown;
    try {
      ({ body } = await this.priceAndStockRaw(skus, opts.includeSpecs));
    } catch (err) {
      // A whole-batch rejection (e.g. one bad SKU failing validation) shouldn't sink the other 49.
      if (err instanceof IngramApiError && err.status === 400 && skus.length > 1) {
        const mid = Math.ceil(skus.length / 2);
        return [...(await this.priceAndStock(skus.slice(0, mid), opts)), ...(await this.priceAndStock(skus.slice(mid), opts))];
      }
      if (err instanceof IngramApiError && err.status === 400) {
        return [{ ok: false, distributorSku: skus[0]!, error: err.message, raw: err.body }];
      }
      throw err;
    }
    const results = parsePriceAndAvailability(body, this.warehouseCountries);
    // Anything Ingram silently left out of the response counts as a failure for that SKU.
    const seen = new Set(results.map((r) => r.distributorSku));
    for (const sku of skus) {
      if (!seen.has(sku)) results.push({ ok: false, distributorSku: sku, error: 'Not returned by Ingram', raw: null });
    }
    return results;
  }

  async details(sku: string): Promise<ProductDetails> {
    try {
      const { body } = await this.client.get<any>(`/resellers/v6/catalog/details/${encodeURIComponent(sku)}`);
      return parseDetails(body);
    } catch (err) {
      // Ingram documents details as USA/India/Netherlands only; any 4xx other than "slow down" means unavailable here.
      if (err instanceof IngramApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw new DetailsUnavailableError(err.message);
      }
      throw err;
    }
  }
}
