# Combined Distributor Catalog

One product catalog for an MSP's IT store, built from the data of several IT distributors.
Every real-world product appears once, along with what each distributor charges for it and how much they have in stock.

## Language

### Products and offers

**Master Product**:
One real-world product, identified by its Manufacturer and normalized MPN. It has a single entry no matter how many distributors carry it.
_Avoid_: item, SKU, listing

**Offer**:
One distributor's listing of a Master Product: the distributor's own SKU, our cost, MSRP and that distributor's stock.
_Avoid_: listing, distributor product, SKU

**Manufacturer**:
The brand that makes the product (Lenovo, HP, Dell). Distributors call it "vendor", but in this project vendor is never used for it.
_Avoid_: vendor, brand, OEM

**MPN** (manufacturer part number):
The part number the Manufacturer assigns. The raw value is kept exactly as received. A normalized form (uppercase, no spaces, dashes or dots) is what gets compared.
_Avoid_: vendor part number, VPN, model number

**Distributor SKU**:
The distributor's own identifier for an Offer (at Ingram, the "Ingram part number").
_Avoid_: part number (ambiguous), item number

**Distributor**:
A wholesaler we buy from: Ingram Micro Canada, TD Synnex Canada or D&H Canada.
_Avoid_: supplier, vendor

### Prices and stock

**Cost**:
What the distributor charges us for one unit, before any markup.
_Avoid_: price (ambiguous), dealer price, customer price

**MSRP**:
The manufacturer's suggested retail price as reported by the distributor.
_Avoid_: retail price, list price

**Warehouse Stock**:
The quantity of an Offer available at one distributor warehouse at the moment it was last refreshed.
_Avoid_: inventory, availability

### Operations

**Catalog Sync**:
The scheduled bulk pull that adds and updates Offers and Master Products for everything in the Scope.
_Avoid_: import, crawl

**Price & Stock Refresh**:
The scheduled update of Cost, MSRP and Warehouse Stock for Offers already in the catalog.
_Avoid_: P&A sync, availability sync

**Live Quote Check**:
An on-demand check of current Cost and stock with distributors, run only for the few products being quoted. It is never used to build the catalog.
_Avoid_: real-time sync

**Sync Run**:
The record of one execution of a Catalog Sync or Price & Stock Refresh, with its counts and errors.
_Avoid_: job, batch

**Scope**:
The editable list of Manufacturers and categories that the Catalog Sync pulls.
_Avoid_: filter, whitelist

**Match Review**:
An Offer that could not be linked to a Master Product with confidence. It waits for a person to decide.
_Avoid_: unmatched queue, exceptions
