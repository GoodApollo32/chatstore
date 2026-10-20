# Product Catalog — Phase 1 (Ingram Micro Canada)

This program builds our own product catalog from Ingram Micro Canada's data and shows it on an internal
search page. For each product you see our cost, MSRP, EHF, stock in each warehouse, and when it was last checked.
It also produces a **data-quality report**, which shows how complete Ingram's data is and what was left out.

- **Version-one scope:** laptops, desktops, monitors and docking stations from Lenovo, HP and Dell.
  You can edit this list (see "Changing what gets pulled").
- **It never places orders.** It is physically unable to call Ingram's ordering functions.
- **It runs on this PC only.** Nobody else on the network can open the page, and your Ingram keys stay in a file on this PC.

---

## One-time setup (about 20 minutes)

### 1. Install Docker Desktop
1. Go to **https://www.docker.com/products/docker-desktop/** and click **Download for Windows**.
2. Run the installer and keep the default options. Restart the PC if it asks.
3. Open **Docker Desktop** from the Start menu. Accept the terms. You can skip signing in.
4. Wait until the bottom-left corner says **Engine running** (green).

Docker Desktop is the only program you need to install. It runs the catalog and its database.

### 2. Download the catalog program
1. On GitHub, open the project and click the green **Code** button, then **Download ZIP**.
2. Right-click the downloaded ZIP, choose **Extract All…**, and extract it to a folder you'll keep,
   e.g. `Documents\Catalog`.

### 3. Enter your Ingram keys
1. In that folder, double-click **Edit Settings**. Notepad opens with the settings file.
2. Fill in the lines after the `=` sign (no spaces, no quotes):
   - `INGRAM_CLIENT_ID` and `INGRAM_CLIENT_SECRET`: from the Ingram developer portal → **My Apps** → your app.
   - `INGRAM_CUSTOMER_NUMBER`: your Ingram Micro Canada reseller account number.
   - `INGRAM_ENV`: `sandbox` if those are keys for your **sandbox (test) app**, `production` if they are for your
     approved **production app**. Sandbox keys only work with `sandbox`, and production keys only with `production`.
3. Save (**Ctrl+S**) and close Notepad.

Never email these keys or paste them into a chat. They only need to be in this file.

### 4. Check the connection
Double-click **Check Ingram Connection**. The first time takes a few minutes. Then it shows:
- ✔ Signed in to Ingram
- ✔ Catalog search works, followed by a few sample products
- ✔ Price & availability works, followed by cost, MSRP, EHF and Canadian stock for those products, and the warehouses seen
- Whether Ingram's "product details" (specifications) are available for Canada

A ✘ line means something needs fixing. See "If something goes wrong" below.

---

## Everyday use

### Start
Double-click **Start Catalog**. The search page opens in your browser at **http://localhost:8080**
(bookmark it). If the page shows an error, wait 30 seconds and refresh. The program is probably still starting.

The very first time, the catalog is empty. Go to **Updates** and click **Run full catalog pull now**.
It can take a while (Ingram returns 100 products per request). The Updates page shows progress.

### Keep prices current
On the **Updates** page:
- **Refresh prices & stock now** updates cost and stock for every product. It takes a few minutes.
- **Run full catalog pull now** also finds new products and notices ones Ingram has dropped. It takes longer.
  It continues where it left off if it was interrupted.

Prices older than 48 hours are still shown but marked **may be out of date**.

### Search
Filter by keyword, part number, Ingram SKU, manufacturer, category, cost range, and "in stock in Canada".
Click a part number to see the full detail: stock in each warehouse, quantity breaks, other fees, special pricing
(internal reference only, never applied), and the raw data Ingram sent.

Discontinued and restricted products are hidden unless you tick **Include discontinued / restricted**.

### Data-quality report
**Data-quality report** in the top bar. It shows how many products were pulled, how many have a part number,
UPC, specifications and images, what's in stock in Canada, what was left out and why, and a "Things to look at" list.
Check **"How Ingram's categories were translated"** after each catalog pull. It shows how each of Ingram's
categories was sorted into ours.

The **Connection to Ingram** box on the Updates page shows when we last heard from Ingram, how many requests were
sent in the last hour, how many requests Ingram's rate limit still allows and when that resets, and whether Ingram
asked us to slow down. The program stays under Ingram's published limit (60 requests a minute) by sending at most 50.

### Stop
Double-click **Stop Catalog**. Your data is kept. Docker Desktop must be running whenever you use the catalog.

---

## Specifications

Ingram Canada doesn't send product specifications, so the program reads the key ones from Ingram's product titles:
processor, memory, storage, screen size, Windows edition, graphics and desktop type. You can filter on them on the
search page, and each product shows them under its title. Titles are short and sometimes cut off, so not every product
has every spec. The data-quality report's **Searchable key specs** table shows how many do, with example titles
that couldn't be read. Products whose title doesn't state a spec drop out when you filter on that spec.

### Icecat (fuller specifications and photos)

Icecat is a free product-information catalog for brands that sponsor it. To check how much of our catalog it covers:

1. Go to **https://icecat.biz**, click **Register**, and choose the free **Open Icecat** account. Confirm your email.
2. Double-click **Edit Settings** and fill in `ICECAT_USERNAME=` with your Icecat **username** (never your password).
   Save and close.
3. Double-click **Check Icecat**. It looks up 10 products from each manufacturer and shows, for each:
   - ✔ full specifications and photos
   - ~ found, but only basic information
   - ✘ only in Icecat's paid version, or not in Icecat at all

   It ends with a summary per manufacturer. It saves Icecat's replies in the `recordings` folder; nothing in the
   catalog changes.

## Changing what gets pulled

The file `config\scope.json` (open with Notepad) lists:
- **manufacturers**: what to search Ingram for, plus the names Ingram uses for each manufacturer. If the search name
  finds nothing, the pull tries each of the other names automatically. If the report lists "Manufacturer names we
  didn't recognise" and one of them is really Lenovo, HP or Dell, add it here.
- **rules**: how Ingram's categories become ours (Laptops, Desktops, Monitors, Docking Stations), and what to leave
  out (special-bid and configure-to-order listings, refurbished, tablets, parts, bags, warranties, and Lenovo
  laptops/desktops whose part number ends in "CA", the French-Canadian versions). Rules are checked top to bottom;
  the first match wins. Products a rule leaves out disappear from search the next time the catalog starts or updates.
- **warehouseCountries**: lets us state which warehouses are Canadian once we know Ingram's warehouse codes.

Changes apply on the next catalog pull. No restart is needed. If you're unsure about an edit, ask before saving.

## Automatic schedule (off for now)

During the prototype, updates run only when you click the buttons. To try the automatic schedule, open
**Edit Settings** and set `SCHEDULE_ENABLED=true`. By default it pulls the full catalog at 2 am and refreshes prices
and stock at 6 am and 1 pm Pacific. For a short test, also set e.g. `SCHEDULE_REFRESH_EVERY_MINUTES=15`.
Save, then double-click **Start Catalog** again. Set it back to `false` (and the minutes to blank) to switch it off.
The PC must be on with Docker Desktop running for scheduled updates to happen.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Could not start. Is Docker Desktop running?" | Open Docker Desktop, wait for **Engine running**, try again. |
| "The settings file .env is missing" | Double-click **Edit Settings**, fill it in, save. |
| ✘ Could not sign in | The client ID/secret is wrong, or `INGRAM_ENV` doesn't match the app the keys belong to. |
| ✘ Catalog search failed … 401/403 | The app isn't approved for the Product Catalog API, or the customer number is wrong. |
| ✘ Catalog search found no … products | Ingram spells that manufacturer differently. The check lists the names Ingram uses. Put the right one in `ingramSearch` for that manufacturer in `config\scope.json`, save, and run the check again. |
| An update shows **partial** and says Ingram found no products for a manufacturer | Same fix as the line above. The other manufacturers were still pulled, and nothing already in the catalog was hidden. |
| Updates page: **Paused for Ingram's rate limit** | Nothing to do. Ingram's allowance is used up until the time shown; the update carries on by itself after that. |
| Updates page: **Rate limit: Ingram asked us to slow down** | Ingram is limiting how many requests we send. The program waits until Ingram's allowance resets and carries on. If the reset is more than an hour away, the update stops with a message saying when to run it again; it then continues where it stopped. If it keeps happening, the "Ingram said" line is what to send Ingram support. |
| Updates page: **This update looks stuck** | Double-click **Stop Catalog**, then **Start Catalog**. A catalog pull continues where it stopped. |
| An update shows **failed** on the Updates page | The message says why. Every call to Ingram is logged with a reference number Ingram support can trace. |
| Page doesn't open | Make sure the catalog is started, then go to http://localhost:8080. |

---

## For developers

TypeScript (Node 22) + PostgreSQL. `npm install`, then:

| Command | What it does |
|---|---|
| `npm test` | Unit tests. Set `TEST_DATABASE_URL` to a throwaway database to include the database tests. |
| `npm run cli -- smoke` | Connection check (needs the `INGRAM_*` variables). |
| `npm run cli -- catalog` / `refresh` / `report` / `serve` | Run a job, print the report, start the page (needs `DATABASE_URL`). |
| `npm run cli -- icecat` | Icecat coverage check on a sample of products (needs `DATABASE_URL` and `ICECAT_USERNAME`). |

Layout: `src/ingram` (API client with endpoint allowlist, parsing, connector), `src/jobs` (catalog pull, price & stock
refresh, schedule), `src/web` (search page), `src/report` (data-quality report), `db/migrations` (schema),
`config/scope.json` (scope), `test/fixtures` (Ingram responses). Background: `CLAUDE.md`, `CONTEXT.md`, `docs/`.
