// テーブル定義（PostgreSQL）。起動時に冪等に適用する。
// 設定類は小さいため1行の JSON（rc_config）にまとめ、件数が増えるデータは個別のテーブルに分ける。
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS rc_config (
     id smallint PRIMARY KEY CHECK (id = 1),
     data jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS rc_experiments (
     id text PRIMARY KEY,
     created_at timestamptz NOT NULL,
     status text NOT NULL,
     data jsonb NOT NULL,
     lease_owner text,
     lease_until timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS rc_experiments_created_idx ON rc_experiments (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS rc_experiments_status_idx ON rc_experiments (status)`,
  `CREATE TABLE IF NOT EXISTS rc_episodes (
     experiment_id text NOT NULL REFERENCES rc_experiments(id) ON DELETE CASCADE,
     idx integer NOT NULL,
     finished_at timestamptz NOT NULL,
     data jsonb NOT NULL,
     PRIMARY KEY (experiment_id, idx)
   )`,
  `CREATE INDEX IF NOT EXISTS rc_episodes_finished_idx ON rc_episodes (experiment_id, finished_at DESC)`,
  `CREATE TABLE IF NOT EXISTS rc_usage_monthly (
     month text NOT NULL,
     provider_id text NOT NULL,
     totals jsonb NOT NULL,
     PRIMARY KEY (month, provider_id)
   )`,
  `CREATE TABLE IF NOT EXISTS rc_usage_records (
     id text PRIMARY KEY,
     at timestamptz NOT NULL,
     data jsonb NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS rc_usage_records_at_idx ON rc_usage_records (at DESC)`,
  `CREATE TABLE IF NOT EXISTS rc_audit (
     id text PRIMARY KEY,
     at timestamptz NOT NULL,
     data jsonb NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS rc_audit_at_idx ON rc_audit (at DESC)`,
  // ---- 実証研究機能（追加のみ。既存テーブルは変更しない） ----
  `CREATE TABLE IF NOT EXISTS rc_rules (
     id text PRIMARY KEY,
     rule_key text NOT NULL,
     version integer NOT NULL,
     created_at timestamptz NOT NULL,
     data jsonb NOT NULL,
     UNIQUE (rule_key, version)
   )`,
  `CREATE TABLE IF NOT EXISTS rc_rule_pairs (
     id text PRIMARY KEY,
     created_at timestamptz NOT NULL,
     data jsonb NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS rc_prompt_sets (
     id text PRIMARY KEY,
     name text NOT NULL,
     version integer NOT NULL,
     created_at timestamptz NOT NULL,
     data jsonb NOT NULL,
     UNIQUE (name, version)
   )`,
  `CREATE TABLE IF NOT EXISTS rc_studies (
     id text PRIMARY KEY,
     created_at timestamptz NOT NULL,
     status text NOT NULL,
     data jsonb NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS rc_study_sessions (
     study_id text NOT NULL REFERENCES rc_studies(id) ON DELETE CASCADE,
     condition_id text NOT NULL,
     replicate integer NOT NULL,
     seed bigint NOT NULL,
     order_key bigint NOT NULL,
     status text NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     lease_owner text,
     lease_until timestamptz,
     data jsonb NOT NULL DEFAULT '{}'::jsonb,
     PRIMARY KEY (study_id, condition_id, replicate)
   )`,
  `CREATE INDEX IF NOT EXISTS rc_study_sessions_claim_idx ON rc_study_sessions (study_id, status, order_key)`,
  `CREATE TABLE IF NOT EXISTS rc_decisions (
     study_id text NOT NULL REFERENCES rc_studies(id) ON DELETE CASCADE,
     condition_id text NOT NULL,
     replicate integer NOT NULL,
     step integer NOT NULL,
     data jsonb NOT NULL,
     PRIMARY KEY (study_id, condition_id, replicate, step)
   )`,
];
