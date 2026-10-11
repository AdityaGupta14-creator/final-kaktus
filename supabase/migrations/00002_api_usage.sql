CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES profiles(uid) ON DELETE CASCADE,
  endpoint TEXT,
  provider TEXT,
  model TEXT,
  success BOOLEAN NOT NULL,
  failure BOOLEAN NOT NULL,
  error_type TEXT,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_user_uid_created_at ON api_usage(user_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at DESC);

ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
