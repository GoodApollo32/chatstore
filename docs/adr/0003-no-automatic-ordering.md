# No automatic ordering — people place purchase orders

The original plan was to place orders with the best-source distributor automatically once payment cleared. Chris decided against it: the system only sends the team an Order Notification email with the parts list, and a person places the purchase order manually. This leaves room to request a special bid on large orders (see Bid Threshold in `CONTEXT.md`) before buying, which automatic ordering would skip. No distributor order endpoint is called anywhere in the system unless this decision is revisited.
