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
];
