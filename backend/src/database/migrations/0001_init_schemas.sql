DROP SCHEMA IF EXISTS iam CASCADE;
DROP SCHEMA IF EXISTS channel CASCADE;
DROP SCHEMA IF EXISTS product CASCADE;
DROP SCHEMA IF EXISTS ordering CASCADE;
DROP SCHEMA IF EXISTS supplier CASCADE;
DROP SCHEMA IF EXISTS ledger CASCADE;
DROP SCHEMA IF EXISTS risk CASCADE;
DROP SCHEMA IF EXISTS notification CASCADE;
DROP SCHEMA IF EXISTS worker CASCADE;

CREATE SCHEMA iam;
CREATE SCHEMA channel;
CREATE SCHEMA product;
CREATE SCHEMA ordering;
CREATE SCHEMA supplier;
CREATE SCHEMA ledger;
CREATE SCHEMA risk;
CREATE SCHEMA notification;
CREATE SCHEMA worker;

CREATE TABLE iam.admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  mobile TEXT,
  email TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE iam.roles (
  id TEXT PRIMARY KEY,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE iam.user_role_relations (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE iam.operation_audit_logs (
  id TEXT PRIMARY KEY,
  operator_user_id TEXT,
  operator_username TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE iam.login_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel.channels (
  id TEXT PRIMARY KEY,
  channel_code TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'API',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  settlement_mode TEXT NOT NULL DEFAULT 'PREPAID',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel.channel_api_credentials (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  access_key TEXT NOT NULL UNIQUE,
  secret_key_encrypted TEXT NOT NULL,
  sign_algorithm TEXT NOT NULL DEFAULT 'HMAC_SHA256',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, access_key)
);

CREATE TABLE channel.channel_product_authorizations (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, product_id)
);

CREATE TABLE channel.channel_price_policies (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sale_price NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, product_id)
);

CREATE TABLE channel.channel_limit_rules (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  single_limit NUMERIC(18, 2) NOT NULL DEFAULT 10000,
  daily_limit NUMERIC(18, 2) NOT NULL DEFAULT 100000,
  monthly_limit NUMERIC(18, 2) NOT NULL DEFAULT 1000000,
  qps_limit INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel.channel_callback_configs (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  callback_url TEXT NOT NULL,
  sign_type TEXT NOT NULL DEFAULT 'HMAC_SHA256',
  secret_encrypted TEXT NOT NULL,
  retry_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  timeout_seconds INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel.channel_request_nonces (
  id TEXT PRIMARY KEY,
  access_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  request_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (access_key, nonce)
);

CREATE TABLE product.mobile_segments (
  id TEXT PRIMARY KEY,
  mobile_prefix TEXT NOT NULL UNIQUE,
  province_name TEXT NOT NULL,
  city_name TEXT,
  isp_code TEXT NOT NULL,
  isp_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product.recharge_products (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  carrier_code TEXT NOT NULL,
  province_name TEXT NOT NULL DEFAULT '全国',
  face_value NUMERIC(18, 2) NOT NULL,
  recharge_mode TEXT NOT NULL,
  sales_unit TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product.product_supplier_mappings (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_product_code TEXT NOT NULL,
  route_type TEXT NOT NULL DEFAULT 'PRIMARY',
  priority INTEGER NOT NULL DEFAULT 1,
  cost_price NUMERIC(18, 2) NOT NULL,
  sales_status TEXT NOT NULL DEFAULT 'ON_SALE',
  inventory_quantity INTEGER NOT NULL DEFAULT 999999,
  dynamic_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, supplier_id)
);

CREATE TABLE product.product_sync_logs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ordering.orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  channel_order_no TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  parent_channel_id TEXT,
  product_id TEXT NOT NULL,
  mobile_number TEXT NOT NULL,
  province_name TEXT,
  isp_code TEXT,
  face_value NUMERIC(18, 2) NOT NULL,
  sale_price NUMERIC(18, 2) NOT NULL,
  cost_price NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  payment_mode TEXT NOT NULL DEFAULT 'BALANCE',
  main_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  supplier_status TEXT NOT NULL,
  notify_status TEXT NOT NULL,
  requested_product_type TEXT NOT NULL DEFAULT 'MIXED',
  refund_status TEXT NOT NULL DEFAULT 'NONE',
  monitor_status TEXT NOT NULL DEFAULT 'NORMAL',
  risk_status TEXT NOT NULL,
  callback_url TEXT,
  warning_deadline_at TIMESTAMPTZ,
  expire_deadline_at TIMESTAMPTZ,
  channel_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  callback_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  supplier_route_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  exception_tag TEXT,
  remark TEXT,
  request_id TEXT NOT NULL,
  ext_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (channel_id, channel_order_no)
);

CREATE TABLE ordering.order_events (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_service TEXT NOT NULL,
  source_no TEXT,
  before_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  operator TEXT NOT NULL,
  request_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier.suppliers (
  id TEXT PRIMARY KEY,
  supplier_code TEXT NOT NULL UNIQUE,
  supplier_name TEXT NOT NULL,
  protocol_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier.supplier_configs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL UNIQUE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_encrypted TEXT NOT NULL,
  callback_secret_encrypted TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 3000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier.supplier_request_logs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  order_no TEXT,
  supplier_product_code TEXT,
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_status TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier.supplier_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_order_no TEXT NOT NULL UNIQUE,
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  standard_status TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_no, supplier_id)
);

CREATE TABLE supplier.supplier_callback_logs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT,
  supplier_code TEXT NOT NULL,
  order_no TEXT,
  supplier_order_no TEXT,
  headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  parsed_status TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier.supplier_reconcile_diffs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  reconcile_date DATE NOT NULL,
  order_no TEXT,
  diff_type TEXT NOT NULL,
  diff_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier.supplier_runtime_breakers (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL UNIQUE,
  breaker_status TEXT NOT NULL DEFAULT 'CLOSED',
  fail_count_window INTEGER NOT NULL DEFAULT 0,
  fail_threshold INTEGER NOT NULL DEFAULT 5,
  opened_at TIMESTAMPTZ,
  last_probe_at TIMESTAMPTZ,
  recovery_timeout_seconds INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ledger.accounts (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  available_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  frozen_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_type, owner_id, currency)
);

CREATE TABLE ledger.account_ledgers (
  id TEXT PRIMARY KEY,
  ledger_no TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  order_no TEXT,
  action_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  balance_before NUMERIC(18, 2) NOT NULL,
  balance_after NUMERIC(18, 2) NOT NULL,
  reference_type TEXT NOT NULL,
  reference_no TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE risk.risk_rules (
  id TEXT PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE risk.risk_black_white_list (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  list_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entry_type, target_value, list_type)
);

CREATE TABLE risk.risk_decisions (
  id TEXT PRIMARY KEY,
  order_no TEXT,
  channel_id TEXT,
  mobile TEXT,
  ip TEXT,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  hit_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification.notification_tasks (
  id TEXT PRIMARY KEY,
  task_no TEXT NOT NULL UNIQUE,
  order_no TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  notify_type TEXT NOT NULL,
  destination TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification.notification_delivery_logs (
  id TEXT PRIMARY KEY,
  task_no TEXT NOT NULL,
  request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_status TEXT,
  response_body TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification.notification_dead_letters (
  id TEXT PRIMARY KEY,
  task_no TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE worker.worker_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  business_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_type, business_key)
);

CREATE TABLE worker.worker_job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE worker.worker_dead_letters (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  business_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ordering_orders_channel_created
  ON ordering.orders (channel_id, created_at DESC);

CREATE INDEX idx_ordering_order_events_order_no
  ON ordering.order_events (order_no, occurred_at DESC);

CREATE INDEX idx_product_mobile_segments_prefix
  ON product.mobile_segments (mobile_prefix);

CREATE INDEX idx_product_mappings_supplier
  ON product.product_supplier_mappings (supplier_id, priority ASC);

CREATE INDEX idx_supplier_request_logs_order
  ON supplier.supplier_request_logs (order_no, created_at DESC);

CREATE UNIQUE INDEX uq_supplier_reconcile_diffs_dedupe
  ON supplier.supplier_reconcile_diffs (
    supplier_id,
    reconcile_date,
    COALESCE(order_no, ''),
    diff_type
  );

CREATE INDEX idx_ledger_ledgers_order_no
  ON ledger.account_ledgers (order_no, created_at DESC);

CREATE INDEX idx_notification_tasks_order_no
  ON notification.notification_tasks (order_no, created_at DESC);

CREATE INDEX idx_worker_jobs_status_next_run
  ON worker.worker_jobs (status, next_run_at);
