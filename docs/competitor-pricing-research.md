# Competitor pricing research: pricing against CDW.ca

Researched 2026-10-20 for Chris's pricing rule: Customer Price as close to MSRP as possible without going over
CDW.ca's price for the same part. The research session's network blocked cdw.ca and most vendor sites, so the
findings below come from search excerpts of primary pages. Items marked **verify** need a normal browser.

## CDW itself

- **Site terms** (CDW's shared template; US version indexed at
  https://www.cdwg.com/content/cdwg/en/terms-conditions/site-use.html):
  - The licence is "only for your personal, non-commercial use".
  - Expressly prohibited without written permission: "use of any robot, spider, other automatic device, or manual
    process to monitor or copy a Site or any of its content".
  - **Verify:** the cdw.ca wording and robots.txt.
- **No public price API or feed.** The affiliate programme appears closed (affi.io, FlexOffers listings).
  EDI/punchout exists only for CDW's buying customers and gives contract prices, not web prices.
- **Bot protection:** likely, but unconfirmed.
- **Legal background (BC, not legal advice):** Century 21 Canada v. Rogers, 2011 BCSC 1196, enforced browse-wrap
  website terms against a scraper, with damages and an injunction.

**Verdict:** don't scrape cdw.ca ourselves.

## Legitimate sources

| Option | What it gives | Rough cost | Catch |
|---|---|---|---|
| DataForSEO Google Shopping API (Canada) | Google Shopping offers and up to 10 sellers' prices per product | ~US$0.002–0.004 per part checked; 10k parts/day ≈ US$600–1,200/month | CDW only appears if it lists that product on Google Shopping. Google matches by barcode, so some parts (and HP regional variants) won't match. |
| SerpApi Google Shopping (google.ca) | Same data | US$75/5k searches … custom above 30k/month | Dearer than DataForSEO at our volume |
| Google Merchant Center price competitiveness | Free daily "benchmark price" (market average) for products we list on Google | Free | Only for our own Google listings, and it never names CDW |
| Price-monitoring services (Price2Spy, Prisync) | Track any page, cdw.ca included | Price2Spy US$39.95/500 URLs, $157.95/2,000; 10k+ products ≈ hundreds to $1k+/month | The vendor still scrapes CDW, so the terms issue is outsourced, not removed |
| Ingram | Cost, MSRP and minimum advertised price | Already have | No competitor/street price |

## Recommendation

- **Source:** use the DataForSEO Google Shopping API (Canada), reading CDW's price from the seller list. Check only
  parts actually being shown or quoted, plus a daily check of the few hundred that sell most, caching for 24 h.
  This fits the "live checks only for the handful being quoted" principle and keeps cost to tens of dollars a month.
- **Pilot first:** run about 200 real part numbers to measure how often CDW shows up before relying on it.
- **When there's no CDW price:** cap at MSRP (with the category markup fallback).
