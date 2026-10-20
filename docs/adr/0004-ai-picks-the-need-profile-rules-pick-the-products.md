# The chatbot's AI picks the Need Profile; rules pick the products

In the storefront chatbot, the AI's only job is to understand what the Customer typed and decide which of the MSP's
Need Profiles fits, asking follow-up questions when it can't tell. Which products are shown is decided by the
Need Profile's Requirements run against the catalog, and Customer Prices always come from the catalog, never from
the AI. Chris chose this over a fixed question flow (predictable, but can't understand free text) and over letting
the AI search and recommend on its own (flexible, but liable to recommend things outside the MSP's rules or state
wrong prices).
