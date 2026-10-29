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

/**
 * 追加のマイグレーション（適用履歴を rc_schema_migrations に記録する）。
 * - 既存のテーブル・データは変更しない（新しいテーブルの追加のみ）。
 * - 各文は冪等（IF NOT EXISTS）で、同時に起動しても安全。適用済みの ID は再実行しても結果が変わらない。
 * - 一度公開した ID の内容は変更しない。変更が必要な場合は新しい ID を追加する。
 */
export type Migration = { id: string; description: string; statements: string[] };

export const MIGRATIONS: Migration[] = [
  {
    id: '2026-10-29-001-risk-intelligence',
    description: 'トレース・多層評価・人手評価・Failure・原因仮説・修正案・回帰テスト・PoC・監視のテーブルを追加',
    statements: [
      // 実行トレース（セッション単位で1行。Span は data.spans に格納）
      `CREATE TABLE IF NOT EXISTS rc_traces (
         study_id text NOT NULL REFERENCES rc_studies(id) ON DELETE CASCADE,
         condition_id text NOT NULL,
         replicate integer NOT NULL,
         trace_id text NOT NULL UNIQUE,
         started_at timestamptz NOT NULL,
         duration_ms integer NOT NULL,
         status text NOT NULL,
         span_count integer NOT NULL,
         has_error boolean NOT NULL,
         has_violation boolean NOT NULL,
         has_deviation boolean NOT NULL,
         has_boundary boolean NOT NULL,
         model text,
         data jsonb NOT NULL,
         PRIMARY KEY (study_id, condition_id, replicate)
       )`,
      `CREATE INDEX IF NOT EXISTS rc_traces_started_idx ON rc_traces (started_at DESC)`,
      // 評価の実行（LLM Judge など）と、判断ごとの評価結果
      `CREATE TABLE IF NOT EXISTS rc_eval_runs (
         id text PRIMARY KEY,
         study_id text NOT NULL REFERENCES rc_studies(id) ON DELETE CASCADE,
         created_at timestamptz NOT NULL,
         status text NOT NULL,
         data jsonb NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS rc_judgements (
         run_id text NOT NULL REFERENCES rc_eval_runs(id) ON DELETE CASCADE,
         condition_id text NOT NULL,
         replicate integer NOT NULL,
         step integer NOT NULL,
         data jsonb NOT NULL,
         PRIMARY KEY (run_id, condition_id, replicate, step)
       )`,
      // 人による評価（評価者ごとに1件。修正は上書きし、履歴は data.history に残す）
      `CREATE TABLE IF NOT EXISTS rc_annotations (
         study_id text NOT NULL REFERENCES rc_studies(id) ON DELETE CASCADE,
         condition_id text NOT NULL,
         replicate integer NOT NULL,
         step integer NOT NULL,
         annotator text NOT NULL,
         updated_at timestamptz NOT NULL,
         data jsonb NOT NULL,
         PRIMARY KEY (study_id, condition_id, replicate, step, annotator)
       )`,
      // Failure（判断単位で重複なし）と回帰テストケース
      `CREATE TABLE IF NOT EXISTS rc_failures (
         id text PRIMARY KEY,
         study_id text NOT NULL REFERENCES rc_studies(id) ON DELETE CASCADE,
         condition_id text NOT NULL,
         replicate integer NOT NULL,
         step integer NOT NULL,
         fingerprint text NOT NULL,
         created_at timestamptz NOT NULL,
         data jsonb NOT NULL,
         UNIQUE (study_id, condition_id, replicate, step)
       )`,
      `CREATE INDEX IF NOT EXISTS rc_failures_fingerprint_idx ON rc_failures (fingerprint)`,
      `CREATE TABLE IF NOT EXISTS rc_test_cases (
         id text PRIMARY KEY,
         source_key text NOT NULL UNIQUE,
         fingerprint text,
         dataset text NOT NULL,
         status text NOT NULL,
         created_at timestamptz NOT NULL,
         data jsonb NOT NULL
       )`,
      // 原因仮説・修正案・回帰テストの実行
      `CREATE TABLE IF NOT EXISTS rc_hypotheses (
         id text PRIMARY KEY,
         fingerprint text NOT NULL,
         created_at timestamptz NOT NULL,
         status text NOT NULL,
         data jsonb NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS rc_patches (
         id text PRIMARY KEY,
         created_at timestamptz NOT NULL,
         status text NOT NULL,
         data jsonb NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS rc_regression_runs (
         id text PRIMARY KEY,
         patch_id text NOT NULL REFERENCES rc_patches(id) ON DELETE CASCADE,
         created_at timestamptz NOT NULL,
         data jsonb NOT NULL
       )`,
      // PoC の測定値（人が入力した基準値と、実測から自動集計した値を区別する）
      `CREATE TABLE IF NOT EXISTS rc_poc (
         id text PRIMARY KEY,
         created_at timestamptz NOT NULL,
         data jsonb NOT NULL
       )`,
      // 外部イベントの監視（試験版）。テナントで分離する
      `CREATE TABLE IF NOT EXISTS rc_monitor_sources (
         id text PRIMARY KEY,
         tenant_id text NOT NULL DEFAULT 'default',
         token_hash text NOT NULL UNIQUE,
         created_at timestamptz NOT NULL,
         data jsonb NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS rc_monitor_events (
         id text PRIMARY KEY,
         tenant_id text NOT NULL DEFAULT 'default',
         source_id text NOT NULL REFERENCES rc_monitor_sources(id) ON DELETE CASCADE,
         idempotency_key text NOT NULL,
         received_at timestamptz NOT NULL,
         data jsonb NOT NULL,
         UNIQUE (source_id, idempotency_key)
       )`,
      `CREATE INDEX IF NOT EXISTS rc_monitor_events_received_idx ON rc_monitor_events (source_id, received_at DESC)`,
      `CREATE TABLE IF NOT EXISTS rc_monitor_alerts (
         id text PRIMARY KEY,
         tenant_id text NOT NULL DEFAULT 'default',
         source_id text NOT NULL REFERENCES rc_monitor_sources(id) ON DELETE CASCADE,
         created_at timestamptz NOT NULL,
         status text NOT NULL,
         data jsonb NOT NULL
       )`,
    ],
  },
];

