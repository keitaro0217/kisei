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
  {
    id: '2026-11-02-001-auth-attempts',
    description: 'ログイン試行の制限（サーバーレスの複数インスタンスで共有する）',
    statements: [
      // 接続元はハッシュで保存する（IP アドレスそのものは保存しない）
      `CREATE TABLE IF NOT EXISTS rc_auth_attempts (
         key text PRIMARY KEY,
         window_start timestamptz NOT NULL,
         failures integer NOT NULL,
         locked_until timestamptz
       )`,
    ],
  },
  {
    id: '2026-11-03-001-production-foundation',
    description: '組織・プロジェクト・利用者・所属、ジョブキュー、監査ログの改ざん検知と不変化、研究結果の不変化、状態の整合性制約、大量データ向けの索引',
    statements: [
      // ---- 組織・プロジェクト・利用者・所属（個人研究モードでは既定の組織とプロジェクトを1つずつ使う） ----
      `CREATE TABLE IF NOT EXISTS rc_organizations (
         id text PRIMARY KEY,
         name text NOT NULL,
         mode text NOT NULL CHECK (mode IN ('personal', 'team', 'enterprise')),
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE TABLE IF NOT EXISTS rc_projects (
         id text PRIMARY KEY,
         organization_id text NOT NULL REFERENCES rc_organizations(id) ON DELETE RESTRICT,
         name text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now(),
         archived_at timestamptz,
         UNIQUE (organization_id, name)
       )`,
      `CREATE TABLE IF NOT EXISTS rc_users (
         id text PRIMARY KEY,
         email text NOT NULL,
         display_name text NOT NULL,
         password_hash text,
         status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rc_users_email_idx ON rc_users (lower(email))`,
      `CREATE TABLE IF NOT EXISTS rc_memberships (
         id text PRIMARY KEY,
         user_id text NOT NULL REFERENCES rc_users(id) ON DELETE CASCADE,
         organization_id text NOT NULL REFERENCES rc_organizations(id) ON DELETE CASCADE,
         project_id text REFERENCES rc_projects(id) ON DELETE CASCADE,
         role text NOT NULL CHECK (role IN ('owner', 'admin', 'researcher', 'reviewer', 'viewer')),
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rc_memberships_scope_idx ON rc_memberships (user_id, organization_id, coalesce(project_id, ''))`,
      `INSERT INTO rc_organizations (id, name, mode) VALUES ('default', '個人研究', 'personal') ON CONFLICT (id) DO NOTHING`,
      `INSERT INTO rc_projects (id, organization_id, name) VALUES ('default', 'default', '既定のプロジェクト') ON CONFLICT (id) DO NOTHING`,
      // 既存のデータは既定のプロジェクトに属させる（列の追加のみ。既存の行は既定値で埋まる）
      ...['rc_studies', 'rc_experiments', 'rc_rules', 'rc_rule_pairs', 'rc_prompt_sets', 'rc_hypotheses', 'rc_patches', 'rc_test_cases', 'rc_poc'].flatMap((t) => [
        `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'default' REFERENCES rc_projects(id) ON DELETE RESTRICT`,
        `CREATE INDEX IF NOT EXISTS ${t}_project_idx ON ${t} (project_id)`,
      ]),
      // ---- バックグラウンドジョブ（PostgreSQL のキュー。リースで排他し、冪等キーで重複を防ぐ） ----
      `CREATE TABLE IF NOT EXISTS rc_jobs (
         id text PRIMARY KEY,
         project_id text NOT NULL DEFAULT 'default' REFERENCES rc_projects(id) ON DELETE RESTRICT,
         kind text NOT NULL,
         status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
         idempotency_key text UNIQUE,
         attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
         max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
         run_after timestamptz NOT NULL DEFAULT now(),
         lease_owner text,
         lease_until timestamptz,
         last_error text,
         payload jsonb NOT NULL DEFAULT '{}'::jsonb,
         result jsonb,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now(),
         finished_at timestamptz,
         CHECK ((status = 'running') = (lease_until IS NOT NULL)),
         CHECK ((status IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL))
       )`,
      `CREATE INDEX IF NOT EXISTS rc_jobs_claim_idx ON rc_jobs (status, run_after)`,
      `CREATE INDEX IF NOT EXISTS rc_jobs_created_idx ON rc_jobs (created_at DESC)`,
      // ---- 監査ログ: 連番とハッシュの連鎖（改ざんの検知）。更新・削除はデータベースで拒否する ----
      `ALTER TABLE rc_audit ADD COLUMN IF NOT EXISTS seq bigint`,
      `ALTER TABLE rc_audit ADD COLUMN IF NOT EXISTS prev_hash text`,
      `ALTER TABLE rc_audit ADD COLUMN IF NOT EXISTS hash text`,
      // ハッシュの対象にした本文（保存時の文字列そのもの。jsonb はキーの順序を変えるため別に持つ）
      `ALTER TABLE rc_audit ADD COLUMN IF NOT EXISTS body text`,
      `CREATE UNIQUE INDEX IF NOT EXISTS rc_audit_seq_idx ON rc_audit (seq) WHERE seq IS NOT NULL`,
      `CREATE OR REPLACE FUNCTION rc_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION '% は変更・削除できません（履歴として保護されています）', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
       END $$`,
      `DROP TRIGGER IF EXISTS rc_audit_immutable ON rc_audit`,
      `CREATE TRIGGER rc_audit_immutable BEFORE UPDATE OR DELETE ON rc_audit FOR EACH ROW EXECUTE FUNCTION rc_reject_change()`,
      // ---- 研究結果: 判断の記録は追記のみ。完了したセッションの記録は削除できない（途中で止まったセッションのやり直しは可） ----
      `CREATE OR REPLACE FUNCTION rc_protect_decisions() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF TG_OP = 'UPDATE' THEN
           RAISE EXCEPTION '研究の判断の記録は変更できません' USING ERRCODE = 'insufficient_privilege';
         END IF;
         IF EXISTS (SELECT 1 FROM rc_study_sessions s WHERE s.study_id = OLD.study_id AND s.condition_id = OLD.condition_id
                     AND s.replicate = OLD.replicate AND s.status = 'completed') THEN
           RAISE EXCEPTION '完了したセッションの判断の記録は削除できません' USING ERRCODE = 'insufficient_privilege';
         END IF;
         RETURN OLD;
       END $$`,
      `DROP TRIGGER IF EXISTS rc_decisions_protect ON rc_decisions`,
      `CREATE TRIGGER rc_decisions_protect BEFORE UPDATE OR DELETE ON rc_decisions FOR EACH ROW EXECUTE FUNCTION rc_protect_decisions()`,
      // ---- 状態の整合性制約（既存の行は検証せず、新しい書き込みから適用する: NOT VALID） ----
      ...(
        [
          ['rc_studies', 'rc_studies_status_chk', `status IN ('draft', 'running', 'paused', 'completed', 'stopped')`],
          ['rc_study_sessions', 'rc_study_sessions_status_chk', `status IN ('pending', 'running', 'completed', 'failed') AND attempts >= 0`],
          ['rc_experiments', 'rc_experiments_status_chk', `status IN ('queued', 'running', 'pausing', 'paused', 'stopping', 'stopped', 'completed', 'failed')`],
          ['rc_eval_runs', 'rc_eval_runs_status_chk', `status IN ('running', 'completed', 'paused', 'failed')`],
          ['rc_test_cases', 'rc_test_cases_status_chk', `status IN ('candidate', 'approved', 'rejected')`],
          ['rc_patches', 'rc_patches_status_chk', `status IN ('draft', 'under_review', 'approved_for_simulation', 'simulation_completed', 'approved_for_recommendation', 'rejected', 'archived')`],
          ['rc_hypotheses', 'rc_hypotheses_status_chk', `status IN ('HYPOTHESIS', 'SUPPORTED_BY_TRACE', 'EXPERIMENT_SCHEDULED', 'EXPERIMENT_TESTED', 'EVIDENCE_SUPPORTS_EFFECT', 'EVIDENCE_INCONCLUSIVE', 'EVIDENCE_AGAINST_EFFECT')`],
          ['rc_monitor_alerts', 'rc_monitor_alerts_status_chk', `status IN ('open', 'acknowledged', 'resolved')`],
        ] as const
      ).map(
        ([table, name, check]) => `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
             ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check}) NOT VALID;
           END IF;
         END $$`,
      ),
      // ---- 大量データ向けの索引（関連の参照・一覧の並び替え） ----
      `CREATE INDEX IF NOT EXISTS rc_studies_created_idx ON rc_studies (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS rc_eval_runs_study_idx ON rc_eval_runs (study_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS rc_hypotheses_fingerprint_idx ON rc_hypotheses (fingerprint, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS rc_test_cases_fingerprint_idx ON rc_test_cases (fingerprint)`,
      `CREATE INDEX IF NOT EXISTS rc_regression_runs_patch_idx ON rc_regression_runs (patch_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS rc_patches_created_idx ON rc_patches (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS rc_failures_created_idx ON rc_failures (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS rc_monitor_alerts_source_idx ON rc_monitor_alerts (source_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS rc_traces_flags_idx ON rc_traces (study_id) WHERE has_violation OR has_deviation OR has_error`,
    ],
  },
];
