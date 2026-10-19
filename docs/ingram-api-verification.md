# Ingram Micro API — verification against the published spec

Checked against `ingrammicro-xvantage/xi-sdk-openapispec`, commit `7e8c646` (2026-02-18),
spec version `6.0_07082023_US`. Note that the spec is US-flavoured, so anything Canada-specific
must still be confirmed in the sandbox (open questions Q1–Q6 in `docs/handoff-phase1.md`).

## Confirmed

| Brief said | Spec says | Status |
|---|---|---|
| Base URL `https://api.ingrammicro.com:443` | Same | ✅ |
| Headers `IM-CustomerNumber`, `IM-CountryCode`, `IM-CorrelationID` required; `IM-SenderID` optional | Same, on every catalog endpoint | ✅ |
| `GET /resellers/v6/catalog`, `pageSize` max 100 | Same. Also `nextPage`/`previousPage` links and `recordsFound` total | ✅ |
| `POST /resellers/v6/catalog/priceandavailability`, up to 50 products | Same | ✅ |
| `GET /resellers/v6/catalog/details/{ingramPartNumber}` US/IN/NL only | Spec says the same: "Currently, this API is available in the USA, India, and Netherlands" | ✅ (so Q2 is likely "no" for Canada) |

## Differences and corrections

1. **Sandbox URL prefix.** The sandbox uses the same host with a `/sandbox` prefix:
   `https://api.ingrammicro.com:443/sandbox/resellers/v6/...`. Production has no prefix.
   The token endpoint has no sandbox prefix.
2. **Token endpoint is inconsistent within Ingram's own spec.**
   - Path listing and README: `GET /oauth/oauth20/token?grant_type=client_credentials&client_id=…&client_secret=…`
   - Security scheme: `tokenUrl: /oauth/oauth30/token` (standard OAuth2 client credentials, i.e. form POST).
   - Plan: make the token URL configurable, default to `oauth30` with a form POST and fall back to `oauth20`.
     The first sandbox session settles which one works.
   - `expires_in` comes back as a **string**. Parse it, and refresh about 5 minutes early.
3. **`type` filter values** are `IM::physical`, `IM::digital`, `IM::any`, not `Physical/Digital/Any`.
4. **`includePricing` and `includeAvailability` are required** query flags on price & availability (not optional).
5. **Price & availability request body.** `products[]` with `ingramPartNumber` / `vendorPartNumber` / `upc`.
   Optional `showAvailableDiscounts`, `showReserveInventoryDetails`, `availabilityByWarehouse[]`.
   The response is an **array** and can return HTTP **207** (partial success), so each item carries its own
   `productStatusCode` / `productStatusMessage`. Failures must be handled per product.
6. **Search results carry no price, stock, specs or image fields.** They include description, category,
   subCategory, vendorName, vendorPartNumber, upcCode, discontinued/newProduct/directShip flags, `replacementSku`,
   `authorizedToPurchase`, and `links[]`. Specs and images must come from price & availability
   (`includeProductAttributes=true`) or nowhere. That matters for the data-quality report.
7. **Pricing fields:** `pricing.currencyCode`, `customerPrice` (our cost), `retailPrice` (MSRP), `mapPrice`.
   This answers the shape of Q4; whether it's CAD still needs the sandbox.
8. **`serviceFees[]`** (conditionType, description, amount, currencyCode) exists on price & availability.
   This is the likely home of **BC environmental handling fees (EHF)**. Store it raw now.
9. **Warehouse stock:** `availability.availabilityByWarehouse[]` has `warehouseId`, `location`,
   `quantityAvailable`, `quantityBackordered`, `quantityBackorderedEta`, `quantityOnOrder`. No explicit
   country field, so Canada vs. US must be derived from `location`/`warehouseId` (Q5).
10. **Stock Update webhook** (`/resellers/v1/webhooks/availabilityupdate`) exists. It's not Phase 1, but it could later
    replace some of the hourly polling.
11. **Rate limits are not in the spec.** They're only in the portal (Q6). Portal text (from Chris, 2026-10-19):
    60 calls per minute per endpoint for GETs; every reply carries `X-RateLimit-Limit` (e.g. 500, "per app per
    transaction"), `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix time); limits are per API app; over the
    limit → 429. The client sends at most 50/minute, records these headers on every call, and when Remaining hits 0
    or a 429 arrives it waits until Reset (up to an hour; beyond that the run stops and says when to retry).
    Observed by Chris in production use (2026-10-19): `X-RateLimit-Limit: 60` with a reset about every minute,
    i.e. 60 per minute. Still saw occasional 429s at our 50/min, so the client now also waits 1.5 s past the
    reset (it's in whole seconds) and spreads the remaining allowance over the time left in the window.

## Endpoints that must be unreachable in Phase 1 (safety rail)

Order create (v6, v7), modify, cancel; quote create; returns create. The connector will only expose the
token, catalog search, details, and price & availability calls. Any other path will be rejected before it is sent.

## Found while building the connector (spec re-read, 2026-10-19)

12. **`IM-CorrelationID` is limited to 32 characters.** A standard dashed UUID is 36, so the connector sends a UUID
    without dashes (32 hex characters).
13. **Price & availability documents no specs field.** `includeProductAttributes` exists as a flag, but the response
    schema has no attribute list. The parser accepts the shapes Ingram uses elsewhere (`productAttributes`,
    `technicalSpecifications` with `attributeName`/`attributeValue`) in case it shows up for Canada.
14. **Product details carry specs but no images.** `technicalSpecifications[]` (`headername`, `attributename`,
    `attributevalue`), `productDetailDescription`, and `indicators.isRefurbished`. No image fields anywhere in the
    catalog APIs, so images are a content-provider gap.
15. **Warehouse IDs come back as numbers in one example and strings in another**, and some warehouses have no
    `location`. Those can't be placed in a country and never count as In Stock until mapped in `config/scope.json`.
16. **The 207 example nests `pricing` inside `availability`**, unlike the 200 example. The parser accepts both.
