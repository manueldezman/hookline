PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  api_version TEXT NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  key_hash TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  envelope TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  idempotency_hash TEXT,
  created TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS events_idempotency
  ON events(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_account_seq
  ON events(account_id, seq DESC);

CREATE TABLE IF NOT EXISTS endpoints (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  url TEXT NOT NULL,
  event_types TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  secret TEXT NOT NULL,
  failing_since_ms INTEGER,
  created TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS endpoints_account_seq
  ON endpoints(account_id, seq DESC);

CREATE TABLE IF NOT EXISTS deliveries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  endpoint_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  response_status INTEGER,
  error TEXT,
  created TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  next_retry_ms INTEGER
);

CREATE INDEX IF NOT EXISTS deliveries_due
  ON deliveries(status, next_retry_ms);

CREATE INDEX IF NOT EXISTS deliveries_account_seq
  ON deliveries(account_id, seq DESC);

CREATE INDEX IF NOT EXISTS deliveries_event
  ON deliveries(event_id);

CREATE INDEX IF NOT EXISTS deliveries_endpoint
  ON deliveries(endpoint_id);

CREATE TABLE IF NOT EXISTS test_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  created_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS test_events_account_seq
  ON test_events(account_id, seq);
