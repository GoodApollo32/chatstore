# TypeScript (Node) and PostgreSQL

The service is written in TypeScript on Node and stores data in PostgreSQL. TypeScript is the language of Typebot, the planned customer-facing front end, so later integration code and shared types stay in one language. PostgreSQL covers the relational model (master products, offers, warehouse stock) and the keyword and filter search needed now without a separate search engine. Python was the main alternative and was rejected only to keep one language across the system.
