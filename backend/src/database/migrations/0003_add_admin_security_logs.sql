ALTER TABLE iam.admin_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS iam.login_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT NOT NULL,
  ip TEXT NOT NULL,
  device_summary TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iam_login_logs_username_created_at
  ON iam.login_logs (username, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_iam_login_logs_user_id_created_at
  ON iam.login_logs (user_id, created_at DESC);
