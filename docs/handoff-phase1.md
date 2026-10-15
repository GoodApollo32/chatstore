# Handoff: Combined Distributor Catalog — Phase 1 (Ingram Micro Canada)

> Original planning brief, kept as written. `CLAUDE.md` carries forward the durable parts
> (sections 1, 2, 3, 7). Findings that correct section 4 are in `docs/ingram-api-verification.md`.

---

## 1. Who you're working with

**Chris** runs business development for an MSP (managed IT services provider) in **British Columbia, Canada**. He has reseller accounts with **Ingram Micro Canada, TD Synnex Canada and D&H Canada** and knows the distributor side of the business well.

How to work with him:

- **He does not read code.** Explain progress, problems and decisions in business and data terms ("products that didn't match", "stock is stale by 3 hours"), never in terms of function names, files or libraries. When you need a decision from him, frame it as a business choice with a recommendation.
- If you use shorthand codes or IDs (ticket numbers, milestone codes, SKU field names), include a short reference list of what each one means. Don't assume he remembers them.
- Keep him in the loop at milestones, not on every step.
- Show results he can look at: counts, sample products, a simple search page. Don't just report "done".

---

## 2. The big picture (for context — NOT all in scope now)

Chris wants an online IT store for his customers:

1. A **combined product catalog** built from all three distributors' data, refreshed on a schedule.
2. **Live price and stock checks** with the distributors at quote time.
3. A **conversational front end** built on **Typebot** (open-source chatbot/form builder, https://github.com/baptisteArno/typebot.io). It asks customers what they need, calls a search service to find matching products, shows options, and takes payment (Stripe).
4. **Order placement** to the best-source distributor after payment clears, with a human approval step at first.

Planned architecture:

```
Typebot (conversation, product picking, payment)
        │  calls a narrow, read-only search/quote service
        ▼
Our service (combined catalog DB, live pricing, source selection, order placement, order history)
        │
        ▼
Ingram Micro API  ·  TD Synnex (FTP feeds + XML)  ·  D&H (feeds + API)
```

Key principles already decided:

- **Two speeds of data.** Bulk catalog data comes in on a schedule into our own database. Live price-and-availability calls happen only for the handful of items being quoted. Never try to build the catalog by calling live endpoints item by item.
- **One master product, many offers.** A master product is identified by manufacturer + manufacturer part number (MPN), with UPC as a secondary check. Each distributor's listing is an *offer* linked to that master product (distributor SKU, our cost, stock by warehouse, last refreshed).
- **Customers never touch distributor credentials or raw cost data.** The customer-facing side only ever sees a narrow search that returns approved, marked-up prices.
- **Ingram's MCP server is NOT part of this system.** It's for Chris and his staff to explore data from an AI assistant. It's a single URL that unlocks the whole Ingram account, so it must never be wired into anything customer-facing. Typebot doesn't support MCP anyway.

---

## 3. Phase 1 scope (what you are building now)

**Ingram Micro Canada only.** TD Synnex and D&H come later, so design for them (see section 6) but don't build them.

### Milestone 1 — Prove the data

> Every night, pull a focused set of products (starting with Lenovo, HP and Dell laptops available in Canada) from Ingram into our database. Refresh price and stock for those products every hour or two. Provide a simple internal search page so Chris can check the results.

Deliverables:

1. **Project skeleton**: repo, README written for a non-developer ("how to run it, what it does"), config via environment variables, `.env.example` with no real secrets.
2. **Ingram connector**: authenticate, search the catalog by vendor/category with paging, call price & availability in batches, handle rate limits and retries, log every run.
3. **Database**: master products, Ingram offers, warehouse stock, and sync-run history (when it ran, how many products added, updated or failed).
4. **Scheduled jobs**: a nightly catalog sync and an hourly price/stock refresh, both runnable on demand too.
5. **Internal search page**: filter by keyword, vendor, category, in-stock, and price range. It shows our cost, MSRP, stock by warehouse, and last-updated time. Internal only, never public.
6. **A data-quality report** for Chris in plain language: how many products were pulled, how many have an MPN, UPC, specs and images, how many are in stock in Canada, plus any oddities found.

Scope is **driven by config**: a list of vendors and categories Chris can edit. Start with laptops from Lenovo, HP and Dell, then widen to his version-one list (likely desktops, monitors, docks, networking, peripherals; vendors such as Lenovo, HP, Dell, Cisco, Ubiquiti). **Ask Chris to confirm the list.**

### Explicitly out of scope for Phase 1

- Placing orders (don't call any order endpoints, even in sandbox, unless Chris asks).
- Customer-facing anything: Typebot integration, the public storefront, payments.
- TD Synnex and D&H connectors.
- Markup and pricing rules (store raw cost; the markup layer comes later).
- Third-party product content (Etilize etc.); just note the gaps in the data-quality report.

---

## 4. What we know about the Ingram Micro API

Sources: https://developer.ingrammicro.com/reseller/getting-started and the Xvantage reseller SDK docs (https://github.com/ingrammicro-xvantage/xi-sdk-openapispec). **Verify everything below against the official docs and OpenAPI spec before relying on it.** Chris has access to the documentation and can share pages if anything is behind a login.

- **Access flow**: developer portal account linked to Chris's reseller account → register a **sandbox app** (sandbox comes preloaded with test SKUs, orders and invoices) → later register a **production app**. Production approval takes about 2 business days; the application lists the APIs needed and estimated volume.
- **Auth**: OAuth2 access token from client ID + secret. The token endpoint appears to be `https://api.ingrammicro.com:443/oauth/oauth30/token` (client credentials) — **verify**. Cache tokens and refresh them before they expire.
- **Base URL**: `https://api.ingrammicro.com:443`. The sandbox may use a different path prefix — **verify**.
- **Required context on every call**: customer number, country code (**CA**), and a correlation ID; sender ID is optional. The SDK docs list these as `IM-CustomerNumber`, `IM-CountryCode`, `IM-CorrelationID`, `IM-SenderID` — **confirm the exact header names**. Generate a unique correlation ID per request and log it so issues can be traced with Ingram support.
- **Product Catalog endpoints (v6)**:
  - `GET /resellers/v6/catalog`: search. Filters: `keyword`, `vendor`, `vendorPartNumber`, `vendorNumber`, `category`, `type` (Physical/Digital/Any), `hasDiscounts`, plus group/plan params for subscriptions. Paging: `pageNumber`, `pageSize` (**max 100**).
  - `GET /resellers/v6/catalog/details/{ingramPartNumber}`: product details. ⚠️ Docs say this is currently available only in the **USA, India and the Netherlands**, so it may not work for Canada.
  - `GET /resellers/v6/catalog/details`: details by vendor part number / plan.
  - `POST /resellers/v6/catalog/priceandavailability`: **up to 50 products per request**. Flags: `includePricing`, `includeAvailability` (warehouse-level stock), `includeProductAttributes` (detailed specs; without it few product details come back). Also returns discounts and reserve inventory info.
- **Other APIs available (not Phase 1)**: Orders (create, list, status), Quotes, Invoices, Returns, Freight Estimate, Webhooks, Renewals, Deals.
- **Rate limits**: documented in the portal's "Rate Limits" section. Read it and design the sync to stay well under the limits with backoff on 429s.

### Open questions — resolve early (first sandbox session)

| # | Question | Why it matters |
|---|---|---|
| Q1 | Do catalog search and price & availability work with country code **CA** for Chris's Canadian account? | The whole design depends on it. Test it first. |
| Q2 | Does the product-details endpoint work for Canada? If not, can we get the specs we need via price & availability with `includeProductAttributes`? | Determines where specs come from. |
| Q3 | Does Ingram Canada offer a **bulk catalog/price file** (e.g. an FTP download)? | Search at 100 per page is fine for a focused catalog but slow for everything. Chris will ask his rep, so prepare the specific questions. |
| Q4 | What prices come back: Chris's customer-specific cost, MSRP, or both? In CAD? | Needed for correct pricing later. |
| Q5 | What warehouse codes appear for Canada, and how are Canadian and US stock distinguished? | Customers need Canadian stock and realistic ship times. |
| Q6 | What are the actual rate limits for search and price & availability? | Sets the sync schedule and batch sizes. |

Report answers to Chris in plain terms (keep the Q-number reference list with them).

---

## 5. Data model (starting point — refine once you see real data)

**master_product**: one per real-world product
- manufacturer (normalized), manufacturer part number (raw + normalized), UPC/EAN, title, description, category (our own taxonomy, mapped from distributor categories), key specs (structured where possible: CPU, RAM, storage, screen size, GPU, OS, ports, warranty), image URLs, created/updated timestamps.

**distributor_offer**: one per distributor listing of a product
- distributor (`ingram` now; `td_synnex` and `dh` later), distributor SKU, link to master_product, our cost (CAD), MSRP, discounts, status flags (discontinued, direct-ship, etc.), raw payload (stored as-is for debugging and re-parsing), last catalog sync time, last price/stock refresh time.

**offer_stock**: stock per warehouse
- offer, warehouse code, warehouse location/country, quantity available, on order / ETA if provided, refreshed at.

**sync_run**: one row per job run
- job type (catalog / price-stock), started, finished, status, counts (fetched, created, updated, unchanged, failed), error summary.

**match_review_queue**: offers that couldn't be confidently linked to a master product (for later phases, when multiple distributors carry the same item).

MPN normalization rules (build them now, test them with real data):
- Uppercase; strip spaces, dashes and dots for the comparison key, but keep the raw value.
- Handle regional or config suffixes (e.g. HP `#ABA`, `#ABC` for Canada). Keep the suffix in the raw value and decide with Chris whether it's part of the product's identity. For Canadian keyboards and power cords it often matters.
- UPC as a tiebreaker or confirmation; never auto-merge on title similarity alone.

---

## 6. Design for later phases (don't build, but don't block)

- **Distributor connector boundary**: each distributor gets a connector that outputs the same normalized shape (product + offer + stock). TD Synnex will mostly be **FTP files** (daily catalog, hourly stock/price, a customer-specific pricing file) plus XML ordering. D&H will be an **item feed** plus price & availability, order placement and order status APIs.
- **Live quote check**: a function that takes a few master products and asks every distributor carrying them for current price and stock, then picks the best source (price, Canadian stock, warehouse proximity to BC).
- **Search service for Typebot**: a narrow, read-only endpoint (e.g. "laptops, ≥32GB RAM, dedicated GPU, under $2,500, in stock") that returns marked-up customer prices only. It must never return cost or anything from the raw distributor data.
- **Canadian specifics**: CAD pricing, Canadian vs. US warehouses, bilingual packaging SKUs, and **BC environmental handling fees (EHF)** on electronics, which must be captured and passed through correctly.
- **Ordering**: only after payment clears, idempotent (never double-order), human approval step initially, full order record with tracking and serials.

---

## 7. Technical guidance

- **Stack**: your call. Propose one to Chris in plain terms before committing. Suggested default: **TypeScript (Node) + PostgreSQL**. TypeScript lines up with Typebot for the later integration, and Postgres handles the relational model and search well. SQLite is acceptable for the very first local prototype if it speeds things up, but plan to move to Postgres.
- **Hosting**: local first (Docker Compose for the database is fine). Later it will need a small cloud server plus a managed database. Keep it cheap and simple.
- **Secrets**: never commit credentials. Use env vars (`INGRAM_CLIENT_ID`, `INGRAM_CLIENT_SECRET`, `INGRAM_CUSTOMER_NUMBER`, `INGRAM_COUNTRY_CODE=CA`, `INGRAM_ENV=sandbox|production`, `DATABASE_URL`). Sandbox keys are low-risk. **Production keys should be placed on the server directly by Chris, not pasted into chat.**
- **Keep raw payloads**: store the original API response for each product so parsing can be improved later without re-pulling.
- **Be a good API citizen**: respect rate limits, exponential backoff, batch price & availability calls at 50 per request, resume interrupted syncs, log correlation IDs.
- **Tests**: unit tests for MPN normalization and response parsing (use recorded sandbox responses as fixtures). Keep a small "smoke test" command that authenticates and fetches one page.
- **Safety rail**: build the connector so order-placement calls are impossible in Phase 1, not just unused.

---

## 8. What Chris will provide when he's ready

- [ ] Sandbox client ID and secret from the Ingram developer portal
- [ ] Ingram Canada customer number
- [ ] Confirmed version-one vendor and category list
- [ ] Answers from his Ingram rep on Q3 (bulk catalog file) and, if needed, Q1/Q4/Q5
- [ ] Any documentation pages that are behind the portal login

Until he provides credentials, you can: set up the project, the database schema, the connector against the published OpenAPI spec (with mocked responses), the normalization logic and tests, and the search page against sample data.

---

## 9. Definition of done for Milestone 1

- Running the nightly sync against the Ingram **sandbox** (and then production, once approved) fills the database with the configured products.
- The hourly refresh updates cost and stock and records a sync-run entry.
- Chris can open the internal search page, find a product, and see cost, MSRP, Canadian stock by warehouse, and when it was last updated.
- A plain-language data-quality report answers: how many products, what fraction have MPN, UPC, specs and images, how many are in stock in Canada, and what problems were found.
- The open questions (Q1–Q6) are answered or have a clear next step.
- The README explains how to run everything without reading code.

---

## 10. First steps for this session

1. Read this file, then create `CLAUDE.md` from sections 1, 2, 3 and 7.
2. Pull the Ingram reseller OpenAPI spec from https://github.com/ingrammicro-xvantage/xi-sdk-openapispec and confirm the endpoints, header names, auth flow and sandbox base URL against section 4. Note any differences.
3. Propose the stack and project layout to Chris in plain terms. Wait for his OK.
4. Build the skeleton, schema, connector (mocked until credentials arrive), normalization and tests.
5. When Chris supplies sandbox credentials: run the smoke test, answer Q1, Q2, Q4, Q5 and Q6, then run the first real sync and produce the data-quality report.
