import type {
  AppSettings,
  AuditEntry,
  EpisodeResult,
  Experiment,
  ExperimentStatus,
  ExperimentVersion,
  ModelPrice,
  ProviderDTO,
  ResearchRole,
  RoleAssignment,
  UsageRecord,
  UsageTotals,
} from '@/lib/research/types';
import { getDb, resetDbForTests, type Queryable } from '../db';
import { addToTotals, emptyTotals } from '../research/totals';

// 研究データの保存（PostgreSQL）。
// - 設定・プロバイダー・モデル割り当て・単価・実験バージョンは1行の JSON（rc_config）に保存し、行ロックで直列に更新する。
// - 実験・エピソード・使用量・監査ログは件数が増えるため個別のテーブルに保存する。
// サーバーレス（Vercel）では複数のインスタンスが同時に動くため、メモリ上にキャッシュせず毎回データベースを参照する。

export { emptyTotals };

export type ProviderRecord = Omit<ProviderDTO, 'hasApiKey' | 'apiKeyMasked'> & {
  /** AES-256-GCM で暗号化したAPIキー。平文は保存しない */
  encryptedApiKey: string | null;
  apiKeyHint: string | null;
};

export type Config = {
  version: 1;
  settings: AppSettings;
  providers: ProviderRecord[];
  roles: Record<ResearchRole, RoleAssignment>;
  prices: ModelPrice[];
  experimentVersions: ExperimentVersion[];
};

const defaultRole = (role: ResearchRole): RoleAssignment => ({
  role,
  providerId: null,
  model: null,
  reasoning: {},
  maxOutputTokens: role === 'trading_agent' ? 1024 : 2048,
  updatedAt: null,
});

export function initialConfig(): Config {
  return {
    version: 1,
    settings: {
      basic: { appDisplayName: '規制解釈AI 研究コンソール', language: 'ja', timeZone: 'Asia/Tokyo', dateFormat: 'yyyy/MM/dd HH:mm' },
      execution: { episodeConcurrency: 4, episodeRetries: 2, maxConsecutiveFailures: 5 },
      cost: { globalMonthlyBudgetUsd: null },
      observability: { tracePayloadMode: 'redacted', traceRetentionDays: 90 },
    },
    providers: [],
    roles: {
      trading_agent: defaultRole('trading_agent'),
      llm_judge: defaultRole('llm_judge'),
      auto_patch: defaultRole('auto_patch'),
      document_analysis: defaultRole('document_analysis'),
    },
    prices: [],
    experimentVersions: [],
  };
}

/** 保存済みの設定に、後から追加された項目の既定値を補う */
function withDefaults(stored: Partial<Config>): Config {
  const base = initialConfig();
  return {
    ...base,
    ...stored,
    settings: {
      basic: { ...base.settings.basic, ...stored.settings?.basic },
      execution: { ...base.settings.execution, ...stored.settings?.execution },
      cost: { ...base.settings.cost, ...stored.settings?.cost },
      observability: { ...base.settings.observability, ...stored.settings?.observability },
    },
    roles: { ...base.roles, ...stored.roles },
  };
}

// jsonb の値は文字列として渡し、SQL 側で ::text::jsonb に変換する（ドライバーによる二重エンコードを防ぐ）
const json = (value: unknown) => JSON.stringify(value);

// ---- 設定 ----

async function readConfig(q: Queryable, lock: boolean): Promise<Config> {
  await q.query('INSERT INTO rc_config (id, data) VALUES (1, $1::text::jsonb) ON CONFLICT (id) DO NOTHING', [json(initialConfig())]);
  const rows = await q.query<{ data: Partial<Config> }>(`SELECT data FROM rc_config WHERE id = 1${lock ? ' FOR UPDATE' : ''}`);
  return withDefaults(rows[0].data);
}

export async function getConfig(): Promise<Config> {
  return readConfig(await getDb(), false);
}

/** 設定を行ロックのもとで読み、fn で変更して保存する（fn が例外を投げれば保存しない） */
export async function updateConfig<T>(fn: (config: Config) => T | Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const config = await readConfig(tx, true);
    const result = await fn(config);
    await tx.query('UPDATE rc_config SET data = $1::text::jsonb, updated_at = now() WHERE id = 1', [json(config)]);
    return result;
  });
}

// ---- 実験 ----

export async function insertExperiment(exp: Experiment): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_experiments (id, created_at, status, data) VALUES ($1, $2, $3, $4::text::jsonb)', [exp.id, exp.createdAt, exp.status, json(exp)]);
}

export async function listExperiments(limit = 500): Promise<Experiment[]> {
  const db = await getDb();
  const rows = await db.query<{ data: Experiment }>('SELECT data FROM rc_experiments ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map((r) => r.data);
}

export async function getExperimentRecord(id: string): Promise<Experiment | null> {
  const db = await getDb();
  const rows = await db.query<{ data: Experiment }>('SELECT data FROM rc_experiments WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

async function updateExperimentIn<T>(q: Queryable, id: string, fn: (exp: Experiment) => T): Promise<T | null> {
  const rows = await q.query<{ data: Experiment }>('SELECT data FROM rc_experiments WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) return null;
  const exp = rows[0].data;
  const result = fn(exp);
  await q.query('UPDATE rc_experiments SET data = $2::text::jsonb, status = $3 WHERE id = $1', [id, json(exp), exp.status]);
  return result;
}

/** 実験を行ロックのもとで更新する。実験が存在しなければ null */
export async function updateExperiment<T>(id: string, fn: (exp: Experiment) => T): Promise<T | null> {
  const db = await getDb();
  return db.transaction((tx) => updateExperimentIn(tx, id, fn));
}

export async function countActiveExperimentsUsingProvider(providerId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM rc_experiments
      WHERE status IN ('running', 'pausing', 'queued', 'stopping')
        AND (data->'snapshot'->'roles'->'trading_agent'->>'providerId' = $1 OR data->'snapshot'->'roles'->'llm_judge'->>'providerId' = $1)`,
    [providerId],
  );
  return rows[0].n;
}

const ACTIVE: ExperimentStatus[] = ['running', 'pausing', 'stopping'];

/** 処理が必要で、どのワーカーも担当していない（リースが切れている）実験 */
export async function listExperimentsNeedingWork(limit = 10): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM rc_experiments WHERE status = ANY($1::text[]) AND (lease_until IS NULL OR lease_until < now())
      ORDER BY created_at LIMIT $2`,
    [ACTIVE, limit],
  );
  return rows.map((r) => r.id);
}

/** 実験の担当権（リース）を取得する。他のワーカーが有効なリースを持っていれば false */
export async function acquireLease(id: string, owner: string, ms: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE rc_experiments SET lease_owner = $2, lease_until = now() + ($3::int * interval '1 millisecond')
      WHERE id = $1 AND (lease_until IS NULL OR lease_until < now() OR lease_owner = $2) RETURNING id`,
    [id, owner, ms],
  );
  return rows.length > 0;
}

/** リースを延長する。すでに他のワーカーに奪われていれば false */
export async function renewLease(id: string, owner: string, ms: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE rc_experiments SET lease_until = now() + ($3::int * interval '1 millisecond') WHERE id = $1 AND lease_owner = $2 RETURNING id`,
    [id, owner, ms],
  );
  return rows.length > 0;
}

export async function releaseLease(id: string, owner: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE rc_experiments SET lease_owner = NULL, lease_until = NULL WHERE id = $1 AND lease_owner = $2', [id, owner]);
}

export async function hasLiveLease(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query('SELECT 1 FROM rc_experiments WHERE id = $1 AND lease_until > now()', [id]);
  return rows.length > 0;
}

// ---- エピソード ----

/**
 * エピソード結果を保存し、実験の完了・失敗件数を更新する。
 * 同じエピソードが二重に実行された場合（ワーカーの引き継ぎ時など）は最初の結果のみ採用し false を返す。
 */
export async function saveEpisode(experimentId: string, episode: EpisodeResult): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    // 先に実験の行をロックする。エピソードの INSERT（外部キー）が取る共有ロックを
    // 後から排他ロックへ引き上げると、同時に保存する処理同士でデッドロックになるため
    const locked = await tx.query('SELECT 1 FROM rc_experiments WHERE id = $1 FOR UPDATE', [experimentId]);
    if (locked.length === 0) return false;
    const inserted = await tx.query(
      `INSERT INTO rc_episodes (experiment_id, idx, finished_at, data) VALUES ($1, $2, $3, $4::text::jsonb)
        ON CONFLICT (experiment_id, idx) DO NOTHING RETURNING idx`,
      [experimentId, episode.index, episode.finishedAt, json(episode)],
    );
    if (inserted.length === 0) return false;
    await updateExperimentIn(tx, experimentId, (exp) => {
      if (episode.status === 'completed') exp.completedEpisodes += 1;
      else exp.failedEpisodes += 1;
      exp.updatedAt = episode.finishedAt;
    });
    return true;
  });
}

export async function listEpisodeIndexes(experimentId: string): Promise<number[]> {
  const db = await getDb();
  const rows = await db.query<{ idx: number }>('SELECT idx FROM rc_episodes WHERE experiment_id = $1', [experimentId]);
  return rows.map((r) => Number(r.idx));
}

export async function listEpisodes(experimentId: string, limit: number): Promise<{ episodes: EpisodeResult[]; total: number }> {
  const db = await getDb();
  const rows = await db.query<{ data: EpisodeResult }>(
    'SELECT data FROM rc_episodes WHERE experiment_id = $1 ORDER BY finished_at DESC, idx DESC LIMIT $2',
    [experimentId, limit],
  );
  const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM rc_episodes WHERE experiment_id = $1', [experimentId]);
  return { episodes: rows.map((r) => r.data), total: count[0].n };
}

// ---- 使用量 ----

/**
 * API呼び出し1回分の記録を保存し、成功した呼び出しは月次・実験ごとの集計に加算する。
 * ロックは常に「実験の行 → 月次集計の行」の順で取り、同時実行時のデッドロックを防ぐ。
 */
export async function saveUsage(record: UsageRecord): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (record.ok && record.experimentId) {
      await updateExperimentIn(tx, record.experimentId, (exp) => addToTotals(exp.usage, record.usage, record.costUsd));
    }
    await tx.query('INSERT INTO rc_usage_records (id, at, data) VALUES ($1, $2, $3::text::jsonb)', [record.id, record.at, json(record)]);
    if (!record.ok) return;
    const month = record.at.slice(0, 7);
    await tx.query(
      'INSERT INTO rc_usage_monthly (month, provider_id, totals) VALUES ($1, $2, $3::text::jsonb) ON CONFLICT (month, provider_id) DO NOTHING',
      [month, record.providerId, json(emptyTotals())],
    );
    const rows = await tx.query<{ totals: UsageTotals }>(
      'SELECT totals FROM rc_usage_monthly WHERE month = $1 AND provider_id = $2 FOR UPDATE',
      [month, record.providerId],
    );
    const totals = rows[0].totals;
    addToTotals(totals, record.usage, record.costUsd);
    await tx.query('UPDATE rc_usage_monthly SET totals = $3::text::jsonb WHERE month = $1 AND provider_id = $2', [month, record.providerId, json(totals)]);
  });
}

export async function getMonthlyUsage(month: string): Promise<Record<string, UsageTotals>> {
  const db = await getDb();
  const rows = await db.query<{ provider_id: string; totals: UsageTotals }>('SELECT provider_id, totals FROM rc_usage_monthly WHERE month = $1', [month]);
  return Object.fromEntries(rows.map((r) => [r.provider_id, r.totals]));
}

export async function listUsageMonths(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query<{ month: string }>('SELECT DISTINCT month FROM rc_usage_monthly ORDER BY month DESC');
  return rows.map((r) => r.month);
}

export async function listUsageRecords(limit: number): Promise<UsageRecord[]> {
  const db = await getDb();
  const rows = await db.query<{ data: UsageRecord }>('SELECT data FROM rc_usage_records ORDER BY at DESC LIMIT $1', [limit]);
  return rows.map((r) => r.data);
}

// ---- 監査ログ ----

export async function insertAudit(entry: AuditEntry): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_audit (id, at, data) VALUES ($1, $2, $3::text::jsonb)', [entry.id, entry.at, json(entry)]);
}

export async function listAuditEntries(limit: number): Promise<AuditEntry[]> {
  const db = await getDb();
  const rows = await db.query<{ data: AuditEntry }>('SELECT data FROM rc_audit ORDER BY at DESC LIMIT $1', [limit]);
  return rows.map((r) => r.data);
}

/** テスト用: データベース接続を破棄する */
export async function resetStoreForTests() {
  await resetDbForTests();
}
