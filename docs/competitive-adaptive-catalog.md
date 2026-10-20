# Competitive note: Adaptive Catalog

Researched 2026-10-20 for Chris. Adaptive Catalog's own site and docs were unreachable from the build environment, so
the facts below come from search excerpts of its pages (adaptivecatalog.com, docs.adaptivecatalog.com) and of its
ConnectWise and Datto marketplace listings. Some indexed pages are one to two years old. Verify in a demo before
relying on any of it.

## What it is

A product search, quoting and customer-storefront platform for US-style MSPs and IT resellers.

- **Distributors:** Ingram Micro, TD SYNNEX and D&H are named.
- **Price and stock:** checked live for every product in a search's results, down to the warehouse, with each
  distributor's custom price side by side and an in-stock filter. Otherwise it relies on the last search or the
  distributor's nightly price file (e.g. TD SYNNEX FTP; the docs give the Canadian FTP host).
- **Content:** pictures, marketing descriptions, brochures and technical specifications from the major
  manufacturers. Each product page lists every distributor carrying it, with price, stock and vendor part number,
  plus an internal part number you can set.
- **Storefront:**
  - curated products and bundles, with up to six featured products and six featured bundles
  - per-product markup, minimum price and "featured" flag
  - keyword search
  - checkout by Stripe or by e-signature; a won order becomes a won opportunity in the PSA
- **PSA and other integrations:** ConnectWise PSA (REST API; not ConnectWise-certified), Autotask (storefront orders
  create a quote and opportunity) and Kaseya. Also PunchOut, and an API tier.
- **Bid analysis tool:** processes RFPs into bills of materials and suggests upsells.
- **Pricing (may be outdated):** Professional US$195/month (10 storefronts), Enterprise US$495/month (50 storefronts),
  API tier custom.

**Not found:** anything on CAD pricing, Canadian warehouses, EHF, Canadian distributors beyond the TD SYNNEX FTP
note, needs-based or conversational selling, competitor-based pricing, or special-bid thresholds.

## Lessons

1. **Content is table stakes.** They ship specs and images, which confirms the gap we found (Ingram Canada sends
   none). Icecat or paid content isn't optional for a storefront.
2. **The "two speeds" approach matches ours:** bulk price files on a schedule, live checks only for what's on
   screen. Their use of distributor price files suggests asking Ingram Canada for one (Q3).
3. **Side-by-side distributor pricing** is their core internal value. Our Master Product / Offer model is built for
   it once TD SYNNEX and D&H are added.
4. **The PSA is where sales land.** A won storefront order becomes a PSA opportunity or quote. Our Quote Request
   email could do the same, once we know which PSA Chris's MSP uses.
5. **E-signature as a checkout path** suits business clients better than cards. It fits the Quote Request step.
6. **Hand-curated storefronts** (featured items, bundles) take upkeep. Our Need Profiles select matching in-stock
   products automatically, which is less work but needs good specs.
7. **RFP → bill of materials** is a good later idea: an AI reads a client's requirements and produces a quote via
   Need Profiles and the Software List.

## Where this project can differ

- **Canada-first:**
  - CAD pricing; In Stock means Canadian warehouses only
  - BC EHF on its own line
  - Regional Variants kept apart; French-Canadian Lenovo SKUs and special-bid/CTO listings removed
  - Canadian data residency possible (self-hosting)
- **Needs-based, conversational buying** (Need Profiles, Software List, ADR 0004) instead of keyword search over
  hand-picked products.
- **Competitor-aware pricing:** match CDW's price, capped at MSRP, never below the Price Floor (ADR 0005). Theirs is
  markup plus a minimum price.
- **Margin protection:** the per-manufacturer Bid Threshold flags orders for a special-bid request.
- **Ownership:** no per-seat or per-storefront fees, own data, data-quality transparency, built around Chris's process.

## Build vs buy

Adaptive Catalog may already cover much of the internal catalog (multi-distributor price and stock, content,
quoting) for a few hundred US dollars a month. Its API tier could even feed our storefront. Recommendation: before
the cloud move (build step 3), take a demo or trial with a Canadian checklist:

- Ingram Canada and D&H Canada connected with CAD account pricing
- Canadian warehouse stock
- EHF
- spec and image coverage for our actual Lenovo/HP/Dell part numbers
- API terms and price

If it passes, buy the catalog and build only the conversational storefront and pricing on top. If it doesn't, the
Canadian gaps are our differentiation, and we carry on as planned.
