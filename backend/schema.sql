-- InventoryIQ D1 schema. Apply with:
--   wrangler d1 execute inventoryiq --remote --file=schema.sql
-- One row per store; the snapshot is stored whole as JSON text (products + sales log).
CREATE TABLE IF NOT EXISTS stores (
  id         TEXT PRIMARY KEY,               -- 'IQ-' + 10 base32 chars
  token_hash TEXT NOT NULL,                  -- SHA-256 hex of the bearer token; the token itself is never stored
  version    INTEGER NOT NULL DEFAULT 0,     -- 0 = never saved; +1 on every successful PUT
  updated_at TEXT,                           -- ISO-8601, NULL until the first save
  products   TEXT NOT NULL DEFAULT '[]',     -- JSON array
  sales      TEXT NOT NULL DEFAULT '[]',     -- JSON array
  created_at TEXT NOT NULL
);

-- Global AI call counter per UTC day (bounds the Groq bill; cap = AI_DAILY_CAP).
CREATE TABLE IF NOT EXISTS ai_usage (
  day   TEXT PRIMARY KEY,                    -- YYYY-MM-DD (UTC)
  calls INTEGER NOT NULL DEFAULT 0
);
