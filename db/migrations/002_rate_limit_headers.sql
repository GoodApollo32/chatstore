-- Ingram's X-RateLimit-* headers on each reply, so the Updates page can show the remaining allowance.
ALTER TABLE api_call_log
  ADD COLUMN rate_limit_limit     integer,
  ADD COLUMN rate_limit_remaining integer,
  ADD COLUMN rate_limit_reset     timestamptz;
