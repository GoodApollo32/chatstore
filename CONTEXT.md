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

**Regional Variant**:
A Master Product whose MPN differs from another only by a region code (e.g. HP `#ABC` Canada vs `#ABA` US). Each Regional Variant is its own Master Product and is never merged with the others.
_Avoid_: localization, SKU variant

**Category**:
One of our own product groupings (Laptops, Desktops, Monitors, Docking Stations). Each Distributor's categories are translated into it.
_Avoid_: distributor category, product class

**Distributor SKU**:
The distributor's own identifier for an Offer (at Ingram, the "Ingram part number").
_Avoid_: part number (ambiguous), item number

**Distributor**:
A wholesaler we buy from: Ingram Micro Canada, TD Synnex Canada or D&H Canada.
_Avoid_: supplier, vendor

### Prices and stock

**Cost**:
The Distributor's regular account price to us for one unit, before markup, EHF and any Special Pricing.
_Avoid_: price (ambiguous), dealer price, customer price

**Quantity Break**:
A lower Cost that a Distributor gives automatically when the quantity ordered reaches a threshold. It applies whenever the quote quantity qualifies.
_Avoid_: volume discount, tier price

**Special Pricing**:
A conditional discount such as a special bid or promotion, tied to an end customer, a quantity cap or an expiry date. It is recorded for reference and never applied automatically.
_Avoid_: discount (ambiguous), deal price

**EHF** (Environmental Handling Fee):
A provincial recycling fee on electronics, charged per unit. It is kept as a separate amount alongside Cost and never folded into it.
_Avoid_: eco fee, recycling fee, service fee

**MSRP**:
The manufacturer's suggested retail price as reported by the distributor.
_Avoid_: retail price, list price

**Warehouse Stock**:
The quantity of an Offer available at one distributor warehouse at the moment it was last refreshed.
_Avoid_: inventory, availability

**In Stock**:
Units available right now at a Canadian Distributor warehouse. US warehouse stock, on-order and back-ordered quantities never count.
_Avoid_: available, in inventory

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

**Stale Price**:
A Cost or stock figure that hasn't been refreshed for more than 48 hours. It is still shown, with a "may be out of date" flag.
_Avoid_: expired price, old data

**Scope**:
The editable list of Manufacturers and categories that the Catalog Sync pulls.
_Avoid_: filter, whitelist

**Match Review**:
An Offer that could not be linked to a Master Product with confidence. It waits for a person to decide.
_Avoid_: unmatched queue, exceptions

### Orders (later phases)

**Order Notification**:
An email to the MSP team listing the parts a customer has paid for, so a person can place the purchase order with the Distributor. The system never places orders itself.
_Avoid_: auto-order, order placement

**Bid Threshold**:
A dollar amount that, once the total Cost of new hardware from one Manufacturer in an order reaches it, marks the order for a Special Pricing request before the purchase order is placed. It is measured on Cost excluding EHF, per order, and the request happens after the customer has paid the regular price.
_Avoid_: bid trigger, discount threshold

### Storefront (later phases)

**Customer**:
An existing business client of the MSP who uses the storefront chatbot. Version one has no anonymous public buyers and one price list for every Customer.
_Avoid_: user, visitor, buyer, client (ambiguous with the MSP's own wording)

**Need Profile**:
A named kind of need the MSP defines (e.g. "Office / admin desktop"), with the Requirements a product must meet to suit it. The chatbot's AI only decides which Need Profile fits what the Customer said; it never picks products itself.
_Avoid_: persona, use case, bundle, template

**Requirements**:
The conditions attached to a Need Profile that a Master Product must meet, such as Category, minimum processor, memory and storage, and Windows edition.
_Avoid_: filters, criteria, specs (ambiguous)

**Matching Products**:
The In Stock Master Products that meet a Need Profile's Requirements. The Customer sees all of them as a list they can narrow down.
_Avoid_: results, recommendations, picks

**Markup Rule**:
How a Category's Customer Price is derived from Cost: a percentage on top of Cost, with a minimum dollar margin per unit.
_Avoid_: margin rule, pricing rule

**Customer Price**:
The price a Customer sees for one unit: Cost plus the Category's Markup Rule. EHF is shown as its own line beside it and is never folded in. Cost itself is never shown to a Customer.
_Avoid_: sell price, retail price, price (ambiguous)

**Quote Request**:
A Customer's request for a product they picked in the chatbot. It reaches the MSP team by email, and a person follows up with a formal quote; no payment is taken in version one.
_Avoid_: order, lead, inquiry

