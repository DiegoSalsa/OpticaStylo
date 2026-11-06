-- Administrative compatibility only. Fresh databases have an EMPTY historical
-- ledger; existing legacy rows and checksums are preserved, never fabricated.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
