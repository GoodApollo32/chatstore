-- One row per real-world product: Manufacturer + normalized MPN (regional variants stay separate).
CREATE TABLE master_product (
  id              bigserial PRIMARY KEY,
  manufacturer    text NOT NULL,
  mpn_raw         text NOT NULL,
  mpn_normalized  text NOT NULL,
  upc             text,
  title           text NOT NULL,
  description     text,
  category        text NOT NULL,
  specs           jsonb NOT NULL DEFAULT '{}',
  image_urls      jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manufacturer, mpn_normalized)
);

CREATE TABLE sync_run (
  id             bigserial PRIMARY KEY,
  distributor    text NOT NULL,
  job_type       text NOT NULL CHECK (job_type IN ('catalog', 'price_stock')),
  trigger        text NOT NULL,                  -- manual | schedule | command
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'interrupted')),
  counts         jsonb NOT NULL DEFAULT '{}',
  notes          jsonb NOT NULL DEFAULT '[]',     -- plain-language observations, e.g. "details not available for Canada"
  error_summary  text,
  resume_state   jsonb                            -- where to pick up if the run is interrupted
);

-- One distributor's listing of a product. master_product_id is null while it waits in match review.
CREATE TABLE distributor_offer (
  id                       bigserial PRIMARY KEY,
  distributor              text NOT NULL,
  distributor_sku          text NOT NULL,
  master_product_id        bigint REFERENCES master_product(id),
  manufacturer_raw         text NOT NULL,
  mpn_raw                  text,
  upc                      text,
  title                    text NOT NULL,
  distributor_category     text,
  distributor_subcategory  text,
  category                 text NOT NULL,
  discontinued             boolean NOT NULL DEFAULT false,
  authorized_to_purchase   boolean NOT NULL DEFAULT true,
  direct_ship              boolean NOT NULL DEFAULT false,
  listed                   boolean NOT NULL DEFAULT true,  -- false once the distributor stops returning it
  refurbished              boolean NOT NULL DEFAULT false, -- set when product details reveal it; always hidden
  cost                     numeric(12,2),
  msrp                     numeric(12,2),
  map_price                numeric(12,2),
  currency                 text,
  ehf                      numeric(12,2),
  fees                     jsonb NOT NULL DEFAULT '[]',
  quantity_breaks          jsonb NOT NULL DEFAULT '[]',
  special_pricing          jsonb NOT NULL DEFAULT '[]',
  price_stock_error        text,
  raw_search               jsonb,
  raw_price_stock          jsonb,
  raw_details              jsonb,
  details_status           text,                       -- null (not tried) | ok | unavailable | failed
  last_seen_run_id         bigint REFERENCES sync_run(id),
  catalog_synced_at        timestamptz,
  price_stock_refreshed_at timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (distributor, distributor_sku)
);
CREATE INDEX distributor_offer_master_idx ON distributor_offer (master_product_id);

CREATE TABLE offer_stock (
  offer_id             bigint NOT NULL REFERENCES distributor_offer(id) ON DELETE CASCADE,
  warehouse_id         text NOT NULL,
  location             text,
  country              text CHECK (country IN ('CA', 'US')),
  quantity_available   integer NOT NULL DEFAULT 0,
  quantity_backordered integer NOT NULL DEFAULT 0,
  quantity_on_order    integer NOT NULL DEFAULT 0,
  backorder_etas       jsonb NOT NULL DEFAULT '[]',
  refreshed_at         timestamptz NOT NULL,
  PRIMARY KEY (offer_id, warehouse_id)
);

-- Offers that couldn't be linked to a master product with confidence; a person decides.
CREATE TABLE match_review (
  id                     bigserial PRIMARY KEY,
  offer_id               bigint NOT NULL REFERENCES distributor_offer(id) ON DELETE CASCADE,
  reason                 text NOT NULL,
  candidate_product_ids  jsonb NOT NULL DEFAULT '[]',
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz
);
CREATE UNIQUE INDEX match_review_open_offer_idx ON match_review (offer_id) WHERE status = 'open';

-- Products the catalog pull saw but left out (parts, refurbished, out-of-scope categories...),
-- kept per run so the data-quality report can count them and show how categories were translated.
CREATE TABLE excluded_listing (
  run_id                   bigint NOT NULL REFERENCES sync_run(id) ON DELETE CASCADE,
  distributor              text NOT NULL,
  distributor_sku          text NOT NULL,
  manufacturer_raw         text,
  title                    text,
  distributor_category     text,
  distributor_subcategory  text,
  reason                   text NOT NULL,
  PRIMARY KEY (run_id, distributor, distributor_sku)
);

-- Every call to a distributor, with the correlation ID to quote to their support.
CREATE TABLE api_call_log (
  id              bigserial PRIMARY KEY,
  run_id          bigint REFERENCES sync_run(id) ON DELETE SET NULL,
  distributor     text NOT NULL,
  correlation_id  text NOT NULL,
  method          text NOT NULL,
  path            text NOT NULL,
  status          integer,
  duration_ms     integer NOT NULL,
  attempt         integer NOT NULL,
  error           text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_call_log_at_idx ON api_call_log (at);
