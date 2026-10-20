# Storefront design (later phase): decisions so far

Working notes from the design session with Chris (started 2026-10-20). Terms are defined in `CONTEXT.md`; Typebot
facts are in `docs/typebot-research.md`; the AI/rules split is ADR 0004.

## Settled

| # | Decision |
|---|---|
| Customers | Existing business clients only, one price list. No sign-in in v1: the Storefront is shared only with clients; the chatbot asks name, company and email, and the team checks the company when following up. |
| AI's role | Understands what the Customer types and picks a Need Profile, asking follow-ups when unsure. Requirements pick the products; prices come from the catalog (ADR 0004). |
| AI provider | Claude, smaller/cheaper model, via the chatbot's Claude block. |
| What's shown | All Matching Products (In Stock in Canada, enough for the quantity), as a filterable list. |
| Page | Full-screen Storefront: a single question box first; once the bot has matches (or after follow-up questions) the page scrolls to a store-style product list; the chat stays available at the top to narrow things down. |
| Quantity | Asked (default 1). Only products with at least that many In Stock in Canada match. The Quote Request notes when it would reach the Bid Threshold. |
| After picking | Quote Request: the team gets an email and a person follows up with a formal quote. No payment in v1. |
| Price freshness | Catalog price, labelled "price confirmed when we send your quote"; the team confirms live before quoting. Live checks become required once card payment is added. |
| Specs for matching | Read the key facts (processor, memory, storage, Windows edition) out of Ingram's product titles first; a paid content provider later. |
| EHF | Shown as its own line beside the Customer Price. |
| Hosting | Catalog and search service move to a small cloud server (the chatbot can't reach Chris's PC). |
| Need Profiles (v1) | Office/admin desktop; office/admin laptop; power-user/engineering laptop; power-user desktop/workstation; monitor by size; docking station (matched to laptop brand). |
| Office/admin desktop | Desktops (tower, small form factor, mini PC; all-in-one only if asked); Core i5 / Core Ultra 5 / Ryzen 5 or better; 16 GB+ memory; 512 GB+ SSD; Windows 11 Pro; no price cap unless the Customer gives a budget. |

## Open

- **Chatbot product and hosting**: TBD; it is the last part of the build and Chris pitches it to the business first.
  Typebot fits the page design: embedded inline in our page, it can tell the page to show matches (client-side
  script) and the page can send filters back (`Typebot.sendCommand` / `setPrefilledVariables`).
- **Customer Price**: Chris wants "as close to MSRP as possible without going over CDW.ca's price for that part".
  Scraping cdw.ca is against CDW's site terms (see `docs/competitor-pricing-research.md`). The recommended source is
  CDW's price as listed on Google Shopping, via a paid search-data service, checked only for parts shown or quoted.
  Pilot on ~200 part numbers first. Floor and fallback rules are pending.
- Requirements for the other five Need Profiles; Quote Request email contents; product list fields and filters.
