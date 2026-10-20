-- Why an offer is left out when the scope rules (e.g. after an edit) now exclude it; such offers are not listed.
ALTER TABLE distributor_offer ADD COLUMN excluded_reason text;

-- Searchable key specs (processor, memory, storage, screen, ...) in a fixed shape, and where each came from
-- (e.g. "title" for Ingram's product title, later "icecat").
ALTER TABLE master_product
  ADD COLUMN facts        jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN fact_sources jsonb NOT NULL DEFAULT '{}';
