# Typebot research: conversational storefront (later phase)

Researched 2026-10-20 for Chris's request: a customer tells the chatbot what they need ("a desktop for admin-style
work") and the bot either asks follow-up questions or points to one or two catalog products, by rules we set.

Source: the official repo `baptisteArno/typebot.io` at commit `2f0aece` (2026-10-19). It holds the docs source
(`apps/docs/*.mdx`, published at docs.typebot.com, formerly docs.typebot.io) and the plan limits
(`packages/billing/src/constants.ts`). The typebot.com sites themselves were blocked from the research session, so
check live prices before committing to anything.

## Verdict

Typebot can do this without anything exotic:

- Its HTTP Request block calls our own read-only search service from Typebot's server, so our key never reaches the
  customer's browser.
- A Claude (Anthropic) or OpenAI block turns free text into structured answers ("Generate variables").
- A Cards carousel shows the products returned.
- A Stripe block takes payment in CAD, with the amount set from a variable.

## Findings

### Calling our search service (HTTP Request block)

- **Request:** any method, headers, query params and a JSON body. Variables work everywhere.
- **Auth:** no auth UI, so we pass a bearer or API-key header.
- **Runs on Typebot's server** by default (`isExecutedOnClient: false`). The flow engine also runs on the server.
- **Reading the response:** server-side JavaScript expressions over `data` and `statusCode` save results into
  variables, e.g. `data.items.map(i => i.title)`.
- **Timeout:** 10 s by default, 120 s at most. A timeout counts as an error (408).
- **No error path:** map `statusCode` into a variable and branch with a Condition block. "Greater than" on a list
  compares its length.
- **No loop block:** use list-driven inputs (Cards, Buttons) or Pop/Shift plus Jump.
- **Our service must have a public internet address.** Typebot refuses localhost and private network addresses
  (SSRF protection). Self-hosted Typebot can allow private hosts via `SSRF_ALLOWED_HOSTS`, but never loopback.
  A service running on Chris's PC needs a tunnel or, better, the planned cloud server.

### AI blocks

- **Anthropic block:**
  - "Create Chat Message": system prompt, chat history ("Dialogue") variable, model choice. Tools are supported in
    the code (up to 10 round-trips) but are undocumented.
  - "Generate variables": structured extraction into typed variables (string, number, boolean, array, enum), each
    with a description and a required flag.
- **OpenAI block:** chat completion with tools; "Ask Model" (Responses API); "Generate variables". "Ask Assistant" is
  deprecated and goes away in Aug 2026.
- **Tool code** runs server-side in a sandbox. It has `fetch` (returns a string), `setVariable`, and no imports.
  An LLM could therefore call our API directly, but the key would sit in the bot definition.
- **Other providers:** Mistral, DeepSeek, Groq, OpenRouter, Perplexity, Together AI, Dify.
- **Pattern that keeps prices honest:** "Generate variables" until the slots are filled, then an HTTP Request to our
  service, then a Cards carousel built from its reply. Optionally an LLM writes a short summary using only the
  returned products. Prices then always come from our service, never from the LLM.

### Showing products

- **Cards:** dynamic, built from list variables. Each card has an image, title, description and buttons. A hidden
  "internal value" carries the SKU.
- **Buttons and Picture choice:** also support dynamic items from a list variable.
- **Text bubbles:** support variables, inline JS formatting and links.
- **Variables hold only text or lists of text.** Our service should return parallel lists (titles[], prices[],
  urls[]) or a JSON string.

### Payment (Stripe only)

- The amount comes from a variable and is computed on the server. Currency is set per block; CAD is supported.
- Optional fields: name, email (receipt), phone, address. Apple/Google Pay come via the Stripe dashboard.
  Test keys apply in preview, live keys when published.
- **Gaps:** no line items, no order reference/metadata, no tax handling. Our service would need to record the order
  after payment, or create the Stripe payment itself.
- **Risk:** any variable can be prefilled from the URL. The amount must be set from our service's reply during the
  chat, never from a variable a link could prefill.

### Hosting and pricing

From the repo's billing constants; check typebot.com/pricing before deciding.

| Plan | Price | Chats/month | Seats | Notes |
|---|---|---|---|---|
| Free | $0 | 200 | 1 | Typebot branding shown |
| Starter | $39/mo | 2,000 | 2 | Branding removed |
| Pro | $89/mo | 10,000 | 5 | Custom domain, WhatsApp, drop-off analytics |
| Enterprise | custom | 100,000 | 10 | |

- **What counts:** a "chat" is one conversation started. Going over the limit auto-bills the next tier.
- **Data residency:** Cloud runs on EU-owned infrastructure; older docs say London. There is **no Canadian region.**
  Self-hosting puts it anywhere, including Canada.
- **Self-hosting licence:** Functional Source License 1.1. Each version becomes Apache 2.0 after two years.
  Using bots in our own customer-facing storefront is explicitly allowed. Reselling Typebot itself is not.

### Embedding and context

- **Embed modes:** Standard (inline), Popup and Bubble. Also a WordPress plugin, plain HTML/JS, React, iframe,
  WhatsApp (Pro), and a headless Chat API.
- **Prefilling:** variables can be prefilled from URL params or the embed code. There are settings to hide query
  params and to restrict which sites may embed the bot.

### Results, handoff, limits

- **Results:** every conversation is stored (partial ones too). There is a transcript view and CSV export.
  Variables are saved only when "Save in results" is on.
- **Handoff to a person:** the Send email block can include the full transcript. The Free plan needs your own SMTP.
  There are also Chatwoot, Zendesk and Gmail blocks.
- **Anything our service returns is stored on Typebot's servers.** Another reason the service returns only
  customer prices, never Cost.

## Implications for our design

1. **A narrow search service in front of the catalog**, as already planned. It returns customer prices and the few
   fields the bot shows, and never Cost or raw distributor data.
2. **The catalog has to leave Chris's PC** (or be tunnelled for a demo) before Typebot can reach it.
3. **Prefer extraction plus rules over a free-roaming AI**: Typebot's "Generate variables" plus our rules picking
   the products. Keeps the API key out of tool code and prices out of the LLM's hands.
4. **Stripe needs our service on both sides of the payment.** It supplies the amount, and records the paid order for
   the Order Notification.
5. **Canadian data residency** would need self-hosting. Cloud is EU/UK only.

Open decisions are being worked through with Chris (grilling session, 2026-10-20).
