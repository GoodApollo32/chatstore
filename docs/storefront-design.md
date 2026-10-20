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

| Customer Price | Match the Competitor Price exactly, capped at MSRP. Never below the Price Floor (Cost + minimum margin), even if that's above CDW or MSRP (the report counts how many). No Competitor Price → Markup Rule, capped at MSRP. |
| Competitor Price source | CDW.ca's price as listed on Google Shopping, via a search-data service (DataForSEO, Canada), checked only for products shown or quoted plus a daily check of best sellers, cached 24 h. Pilot on ~200 part numbers first; if CDW is found for fewer than about half, rethink. Never read from cdw.ca (ADR 0005). |
| Software | A Software List the team keeps (application → maker's recommended specs). Named applications tighten the Need Profile (stricter value wins; strictest across several apps); the bot says why. Unlisted software: "we'll confirm compatibility in your quote", flagged in the Quote Request email. Later: an internal helper drafting list entries for staff approval. |
| Icecat | Chris sets up a free Open Icecat account; the program gets an Icecat coverage check that runs on his PC. |
| Demo before the pitch | Build the Storefront and its product search now; run the chat on Typebot's free plan (200 chats/month, Typebot logo). The question box falls back to a normal product search if the chatbot is off or down. |
| Photos and specs | Icecat's free catalog (Open Icecat). Coverage of our part numbers still to be checked (Icecat was unreachable from the build environment). |
| Product card | Photo, name, key specs (processor, memory, storage, screen), Customer Price with EHF on its own line, "In stock" (no quantities), manufacturer, Request quote. Filters: price, manufacturer, processor level, memory, storage, screen size, form factor. Lowest price first. |
| Quote basket | Several products with quantities, sent as one Quote Request. |
| Quote Request email | Customer name/company/email/phone; each line: manufacturer, MPN, Ingram SKU, quantity, Customer Price shown, Cost and margin (internal); "check live price" reminder with price age; BID THRESHOLD REACHED banner; full chat transcript. |
| Need Profiles | The six drafts are accepted for now (see the table in the chat of 2026-10-20, copied below). |

Need Profile drafts (accepted for now):

| Need Profile | Requirements |
|---|---|
| Office / admin laptop | Laptops; Core i5 / Ultra 5 / Ryzen 5+; 16 GB+; 512 GB+ SSD; Windows 11 Pro; 13–15"; no workstations or gaming |
| Power user / engineering laptop | Mobile workstations; Core i7 / Ultra 7 / Ryzen 7+; 32 GB+; 1 TB+ SSD; NVIDIA RTX professional graphics; Windows 11 Pro |
| Power user desktop / workstation | Desktop workstations or towers; Core i7 / Ultra 7 / Ryzen 7+; 32 GB+; 1 TB+ SSD; dedicated graphics; Windows 11 Pro |
| Monitor | Size asked for (22/24/27/32/34"); 1080p+, 1440p+ at 27"+; USB-C when docking/single cable is mentioned |
| Docking station | Same manufacturer as the Customer's laptop (asked); USB-C / Thunderbolt to suit |

## Build order (agreed)

1. Finish the catalog: confirm HP, stock and specifications after the latest fixes.
2. Key specs read from Ingram titles; Icecat photos and specs.
3. Move catalog to a small cloud server.
4. Customer-price engine: CDW pilot, MSRP cap, Price Floor, category Markup Rules.
5. Storefront: question box (plain search first), filterable product list, quote basket, Quote Request email.
6. Chat on Typebot's free plan for the pitch: Need Profiles and Software List.
7. After the pitch: chatbot plan/hosting and Canadian data residency.

## Open

- **Chatbot product and hosting**: TBD; it is the last part of the build and Chris pitches it to the business first.
  Typebot fits the page design: embedded inline in our page, it can tell the page to show matches (client-side
  script) and the page can send filters back (`Typebot.sendCommand` / `setPrefilledVariables`).
- Category markup percentages and minimum margins (Chris to supply before build step 4).
