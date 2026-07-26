export const SCHEMA_VERSION = 4;

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
  error_message TEXT
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
];

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
] as const;
