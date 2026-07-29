export const SCHEMA_VERSION = 10;

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  remote_url TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  validation_profile_json TEXT NOT NULL DEFAULT '{}',
  integration_json TEXT NOT NULL DEFAULT '{}',
  failure_policy_json TEXT NOT NULL DEFAULT '{}',
  concurrency_json TEXT NOT NULL DEFAULT '{}',
  notifications_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled INTEGER NOT NULL DEFAULT 1,
  overlap_policy TEXT NOT NULL DEFAULT 'skip',
  missed_run_policy TEXT NOT NULL DEFAULT 'skip',
  retry_json TEXT NOT NULL DEFAULT '{}',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disable_after INTEGER,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  schedule_id TEXT REFERENCES schedules(id) ON DELETE SET NULL,
  state TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  trigger TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  not_before_at TEXT,
  expires_at TEXT,
  admitted_at TEXT,
  priority INTEGER NOT NULL DEFAULT 30,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  state TEXT NOT NULL,
  workspace_path TEXT,
  branch_name TEXT,
  starting_commit TEXT,
  result_commit TEXT,
  pr_url TEXT,
  agent_version TEXT,
  agent_adapter TEXT,
  exit_code INTEGER,
  handoff_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  total_cost_usd REAL,
  cost_source TEXT,
  usage_json TEXT,
  model TEXT,
  agent_duration_ms INTEGER,
  UNIQUE(run_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS validations (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  output_path TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  previous_json TEXT,
  new_json TEXT,
  source_ip TEXT,
  auth_method TEXT,
  correlation_id TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_leases (
  id TEXT PRIMARY KEY NOT NULL,
  holder TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_impact_items (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'claimed',
  confidence REAL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(run_id, category, subject)
);

CREATE TABLE IF NOT EXISTS run_integrations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  provider TEXT,
  api_url TEXT,
  repo TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  auto_merge_requested INTEGER NOT NULL DEFAULT 0,
  commit_sha TEXT,
  opened_at TEXT,
  merged_at TEXT,
  closed_at TEXT,
  check_count INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  next_check_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_connections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  base_url TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(adapter, base_url, name)
);

CREATE TABLE IF NOT EXISTS project_sources (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES source_connections(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  external_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  web_url TEXT,
  clone_url TEXT,
  default_branch TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sync_state TEXT NOT NULL DEFAULT 'pending',
  observed_at TEXT,
  next_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, connection_id, kind, external_key)
);

CREATE TABLE IF NOT EXISTS source_sync_cursors (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
  cursor TEXT,
  backfill_complete INTEGER NOT NULL DEFAULT 0,
  rate_limit_json TEXT NOT NULL DEFAULT '{}',
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_webhook_deliveries (
  source_id TEXT NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(source_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES project_sources(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  native_key TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  execution TEXT NOT NULL DEFAULT 'none',
  delivery TEXT NOT NULL DEFAULT 'none',
  outcome TEXT NOT NULL DEFAULT 'pending',
  attention TEXT NOT NULL DEFAULT 'none',
  provenance TEXT NOT NULL DEFAULT 'external',
  actor_name TEXT,
  agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  labels_json TEXT NOT NULL DEFAULT '[]',
  native_state TEXT,
  native_json TEXT NOT NULL DEFAULT '{}',
  web_url TEXT,
  observed_at TEXT,
  next_sync_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  resolution TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  archived_at TEXT,
  UNIQUE(source_id, native_key)
);

CREATE TABLE IF NOT EXISTS work_links (
  id TEXT PRIMARY KEY NOT NULL,
  source_work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  target_work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_work_item_id, target_work_item_id, type)
);

CREATE TABLE IF NOT EXISTS work_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  execution TEXT,
  delivery TEXT,
  outcome TEXT,
  attention TEXT,
  sync_state TEXT,
  resolution TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS work_status_rollup (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  bucket_at TEXT NOT NULL,
  working INTEGER NOT NULL,
  queued INTEGER NOT NULL,
  needs_attention INTEGER NOT NULL,
  verified_open INTEGER NOT NULL,
  stale_open INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, bucket_at)
);

CREATE TABLE IF NOT EXISTS platform_change_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  type TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_resources (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL UNIQUE REFERENCES work_items(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES project_sources(id) ON DELETE SET NULL,
  native_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  native_state TEXT,
  author_name TEXT,
  provenance TEXT NOT NULL DEFAULT 'external',
  labels_json TEXT NOT NULL DEFAULT '[]',
  review_json TEXT NOT NULL DEFAULT '{}',
  checks_json TEXT NOT NULL DEFAULT '{}',
  mergeability TEXT,
  web_url TEXT,
  native_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT,
  next_sync_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, native_key)
);

CREATE TABLE IF NOT EXISTS run_context (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  task_description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  manifest_hash TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  agent_profile_json TEXT NOT NULL DEFAULT '{}',
  adapter TEXT,
  model TEXT,
  validation_json TEXT NOT NULL DEFAULT '{}',
  integration_json TEXT NOT NULL DEFAULT '{}',
  failure_policy_json TEXT NOT NULL DEFAULT '{}',
  base_branch TEXT,
  schedule_json TEXT,
  created_at TEXT NOT NULL
);
`;

/** Incremental migrations applied when an older schema_migrations version is present. */
export const SCHEMA_MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 2,
    sql: `
ALTER TABLE attempts ADD COLUMN input_tokens INTEGER;
ALTER TABLE attempts ADD COLUMN output_tokens INTEGER;
ALTER TABLE attempts ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE attempts ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE attempts ADD COLUMN total_cost_usd REAL;
ALTER TABLE attempts ADD COLUMN cost_source TEXT;
ALTER TABLE attempts ADD COLUMN usage_json TEXT;
ALTER TABLE attempts ADD COLUMN model TEXT;
ALTER TABLE attempts ADD COLUMN agent_duration_ms INTEGER;
`,
  },
  {
    version: 3,
    sql: `
ALTER TABLE attempts ADD COLUMN pr_url TEXT;
`,
  },
  {
    version: 4,
    sql: `
CREATE TABLE IF NOT EXISTS run_impact_items (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'claimed',
  confidence REAL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(run_id, category, subject)
);
CREATE TABLE IF NOT EXISTS run_integrations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  provider TEXT,
  api_url TEXT,
  repo TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  auto_merge_requested INTEGER NOT NULL DEFAULT 0,
  commit_sha TEXT,
  opened_at TEXT,
  merged_at TEXT,
  closed_at TEXT,
  check_count INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  next_check_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 5,
    sql: `
ALTER TABLE runs ADD COLUMN not_before_at TEXT;
ALTER TABLE runs ADD COLUMN expires_at TEXT;
ALTER TABLE runs ADD COLUMN admitted_at TEXT;
ALTER TABLE runs ADD COLUMN priority INTEGER NOT NULL DEFAULT 30;
CREATE INDEX IF NOT EXISTS idx_runs_queue ON runs(state, priority, not_before_at);
`,
  },
  {
    version: 6,
    sql: `
CREATE TABLE IF NOT EXISTS source_connections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  base_url TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(adapter, base_url, name)
);
CREATE TABLE IF NOT EXISTS project_sources (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES source_connections(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  external_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  web_url TEXT,
  clone_url TEXT,
  default_branch TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sync_state TEXT NOT NULL DEFAULT 'pending',
  observed_at TEXT,
  next_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, connection_id, kind, external_key)
);
CREATE TABLE IF NOT EXISTS source_sync_cursors (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
  cursor TEXT,
  backfill_complete INTEGER NOT NULL DEFAULT 0,
  rate_limit_json TEXT NOT NULL DEFAULT '{}',
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_webhook_deliveries (
  source_id TEXT NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(source_id, delivery_id)
);
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES project_sources(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  native_key TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  execution TEXT NOT NULL DEFAULT 'none',
  delivery TEXT NOT NULL DEFAULT 'none',
  outcome TEXT NOT NULL DEFAULT 'pending',
  attention TEXT NOT NULL DEFAULT 'none',
  provenance TEXT NOT NULL DEFAULT 'external',
  actor_name TEXT,
  agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  labels_json TEXT NOT NULL DEFAULT '[]',
  native_state TEXT,
  native_json TEXT NOT NULL DEFAULT '{}',
  web_url TEXT,
  observed_at TEXT,
  next_sync_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  archived_at TEXT,
  UNIQUE(source_id, native_key)
);
CREATE TABLE IF NOT EXISTS work_links (
  id TEXT PRIMARY KEY NOT NULL,
  source_work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  target_work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_work_item_id, target_work_item_id, type)
);
CREATE TABLE IF NOT EXISTS work_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_resources (
  id TEXT PRIMARY KEY NOT NULL,
  work_item_id TEXT NOT NULL UNIQUE REFERENCES work_items(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES project_sources(id) ON DELETE SET NULL,
  native_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  native_state TEXT,
  author_name TEXT,
  provenance TEXT NOT NULL DEFAULT 'external',
  labels_json TEXT NOT NULL DEFAULT '[]',
  review_json TEXT NOT NULL DEFAULT '{}',
  checks_json TEXT NOT NULL DEFAULT '{}',
  mergeability TEXT,
  web_url TEXT,
  native_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT,
  next_sync_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, native_key)
);
CREATE TABLE IF NOT EXISTS run_context (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  task_description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  manifest_hash TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  agent_profile_json TEXT NOT NULL DEFAULT '{}',
  adapter TEXT,
  model TEXT,
  validation_json TEXT NOT NULL DEFAULT '{}',
  integration_json TEXT NOT NULL DEFAULT '{}',
  failure_policy_json TEXT NOT NULL DEFAULT '{}',
  base_branch TEXT,
  schedule_json TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE runs ADD COLUMN work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL;
ALTER TABLE attempts ADD COLUMN agent_adapter TEXT;
`,
  },
  {
    version: 7,
    sql: `
CREATE TABLE IF NOT EXISTS platform_change_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  type TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 8,
    sql: `
ALTER TABLE work_items ADD COLUMN resolution TEXT;
ALTER TABLE work_items ADD COLUMN resolved_at TEXT;
ALTER TABLE work_items ADD COLUMN resolved_by TEXT;
ALTER TABLE work_items ADD COLUMN resolution_note TEXT;
`,
  },
  {
    version: 9,
    sql: `
ALTER TABLE tasks ADD COLUMN notifications_json TEXT NOT NULL DEFAULT '{}';
`,
  },
  {
    version: 10,
    sql: `
ALTER TABLE work_events ADD COLUMN execution TEXT;
ALTER TABLE work_events ADD COLUMN delivery TEXT;
ALTER TABLE work_events ADD COLUMN outcome TEXT;
ALTER TABLE work_events ADD COLUMN attention TEXT;
ALTER TABLE work_events ADD COLUMN sync_state TEXT;
ALTER TABLE work_events ADD COLUMN resolution TEXT;
ALTER TABLE work_events ADD COLUMN archived_at TEXT;
CREATE TABLE IF NOT EXISTS work_status_rollup (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  bucket_at TEXT NOT NULL,
  working INTEGER NOT NULL,
  queued INTEGER NOT NULL,
  needs_attention INTEGER NOT NULL,
  verified_open INTEGER NOT NULL,
  stale_open INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, bucket_at)
);
`,
  },
];

/** Applied after incremental migrations so upgraded DBs have columns first. */
export const SCHEMA_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_runs_queue ON runs(state, priority, not_before_at);
CREATE INDEX IF NOT EXISTS idx_runs_work_item ON runs(work_item_id);
CREATE INDEX IF NOT EXISTS idx_project_sources_sync ON project_sources(sync_state, next_sync_at);
CREATE INDEX IF NOT EXISTS idx_source_webhooks_received ON source_webhook_deliveries(received_at);
CREATE INDEX IF NOT EXISTS idx_work_items_project_updated ON work_items(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_project_state ON work_items(project_id, execution, delivery, attention);
CREATE INDEX IF NOT EXISTS idx_work_items_project_resolution ON work_items(project_id, resolution);
CREATE INDEX IF NOT EXISTS idx_work_events_project_sequence ON work_events(project_id, sequence);
CREATE INDEX IF NOT EXISTS idx_work_events_item_sequence ON work_events(work_item_id, sequence);
CREATE INDEX IF NOT EXISTS idx_work_events_state
  ON work_events(project_id, work_item_id, sequence DESC)
  WHERE execution IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_status_rollup_bucket
  ON work_status_rollup(bucket_at, kind);
CREATE INDEX IF NOT EXISTS idx_platform_events_project_sequence ON platform_change_events(project_id, sequence);
`;

export const EXPECTED_TABLES = [
  "schema_migrations",
  "users",
  "api_tokens",
  "projects",
  "agent_profiles",
  "tasks",
  "schedules",
  "runs",
  "attempts",
  "validations",
  "artifacts",
  "notifications",
  "audit_events",
  "secrets",
  "instance_settings",
  "scheduler_leases",
  "run_impact_items",
  "run_integrations",
  "source_connections",
  "project_sources",
  "source_sync_cursors",
  "source_webhook_deliveries",
  "work_items",
  "work_links",
  "work_events",
  "work_status_rollup",
  "platform_change_events",
  "external_resources",
  "run_context",
] as const;
