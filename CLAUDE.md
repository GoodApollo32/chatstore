# chatstore — Combined Distributor Catalog

Full planning brief: `docs/handoff-phase1.md`. Ingram API findings: `docs/ingram-api-verification.md`.
Read both before starting non-trivial work.

## Who we work for: Chris

Chris runs business development for an MSP in British Columbia, Canada, with reseller accounts at
Ingram Micro Canada, TD Synnex Canada and D&H Canada. He knows the distributor side well.

- **He does not read code.** Report in business/data terms ("products that didn't match", "stock is
  stale by 3 hours"). Never mention function names, files or libraries to him.
- Frame decisions as business choices with a recommendation.
- Any shorthand (Q1–Q6, milestone codes, SKU field names) comes with a short reference list of what each means.
- Update him at milestones, not on every step.
- Show things he can look at: counts, sample products, the search page. Never just say "done".

## The big picture (context only; not all in scope)

1. Combined product catalog from all three distributors, refreshed on a schedule.
2. Live price/stock checks at quote time.
3. Conversational storefront on **Typebot**, calling a narrow read-only search service; Stripe payment.
4. Order placement to the best-source distributor after payment, with human approval at first.

Principles (already decided; don't relitigate):
- **Two speeds of data**: bulk catalog on a schedule into our DB; live price & availability only for the
  handful of items being quoted. Never build the catalog via item-by-item live calls.
- **One master product, many offers**: master product = manufacturer + normalized MPN (UPC as secondary
  check). Each distributor listing is an offer (SKU, cost, stock by warehouse, last refreshed).
  Never auto-merge on title similarity.
- **Customers never see distributor credentials or raw cost.** Customer-facing search returns marked-up
  prices only.
- **Ingram's MCP server is not part of this system.** It's for Chris's staff only. Never wire it into anything.

## Current scope: Phase 1 / Milestone 1 — Ingram Micro Canada only

Nightly pull of a config-driven product set (start: Lenovo, HP, Dell laptops in Canada), refresh price/stock
every 1–2 hours, internal search page, plain-language data-quality report.

Deliverables: README for a non-developer; `.env.example`; Ingram connector (auth, paged search, batched P&A
at 50, rate limits/retries, run logging); DB (master products, offers, warehouse stock, sync runs, match review
queue); nightly + hourly jobs, also runnable on demand; internal search page (keyword, vendor, category,
in-stock, price range; shows cost, MSRP, stock by warehouse, last updated); data-quality report.

Vendor/category scope lives in editable config. Chris must confirm his version-one list.

**Out of scope**: placing orders (never call order endpoints, even sandbox, unless Chris asks); anything
customer-facing (Typebot, storefront, payments); TD Synnex/D&H connectors (design for them, don't build);
markup rules (store raw cost); third-party content (just report gaps).

Design so later phases aren't blocked: every distributor connector emits the same normalized
product + offer + stock shape; capture CAD pricing, Canadian vs US warehouses, and BC EHF (likely in
Ingram `serviceFees`).

## Technical rules

- Stack: proposed TypeScript (Node) + PostgreSQL. Chris has to OK it before code is written.
  Local first (Docker Compose for the DB); later a small cheap cloud server + managed DB.
- **Secrets**: env vars only (`INGRAM_CLIENT_ID`, `INGRAM_CLIENT_SECRET`, `INGRAM_CUSTOMER_NUMBER`,
  `INGRAM_COUNTRY_CODE=CA`, `INGRAM_ENV=sandbox|production`, `DATABASE_URL`). Never commit them.
  Production keys are placed on the server by Chris, never pasted into chat.
- Store raw API payloads per product so parsing can be redone without re-pulling.
- Good API citizen: respect rate limits, exponential backoff on 429/5xx, P&A batches of 50, resumable syncs,
  unique `IM-CorrelationID` per request and log it.
- Tests: MPN normalization and response parsing (recorded sandbox responses as fixtures); a smoke-test
  command that authenticates and fetches one page.
- **Safety rail**: order-placement calls must be impossible in Phase 1 (allowlist of endpoints in the
  connector), not merely unused.

## Open questions (track until answered)

Q1 Does CA work for search + P&A · Q2 Do product details work for Canada (or do we use P&A attributes) ·
Q3 Is there a bulk catalog/price file from Ingram Canada · Q4 Customer cost vs MSRP, CAD? ·
Q5 Canadian warehouse codes vs US · Q6 Actual rate limits.
