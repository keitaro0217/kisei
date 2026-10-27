import type {
  DecisionRecord,
  PromptSet,
  RulePair,
  RuleVersion,
  Study,
  StudySession,
} from '@/lib/research/study-types';
import { getDb, type Queryable } from '../db';

// 実証研究機能のデータ保存（PostgreSQL）。値は ::text::jsonb で渡す（ドライバーの二重エンコードを防ぐ）。

const json = (v: unknown) => JSON.stringify(v);

// ---------- 規則 ----------

export async function insertRuleVersion(rule: RuleVersion): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_rules (id, rule_key, version, created_at, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)', [
    rule.id,
    rule.ruleKey,
    rule.version,
    rule.createdAt,
    json(rule),
  ]);
}

/** 新しい版番号を排他的に採番して保存する（同時保存でも版番号が重複しない） */
export async function insertNextRuleVersion(build: (version: number) => RuleVersion): Promise<RuleVersion> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727101)');
    const rows = await tx.query<{ v: number | null }>('SELECT max(version)::int AS v FROM rc_rules WHERE rule_key = $1', [build(0).ruleKey]);
    const rule = build((rows[0].v ?? 0) + 1);
    await tx.query('INSERT INTO rc_rules (id, rule_key, version, created_at, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)', [
      rule.id,
      rule.ruleKey,
      rule.version,
      rule.createdAt,
      json(rule),
    ]);
    return rule;
  });
}

export async function listRuleVersions(): Promise<RuleVersion[]> {
  const db = await getDb();
  const rows = await db.query<{ data: RuleVersion }>('SELECT data FROM rc_rules ORDER BY rule_key, version DESC');
  return rows.map((r) => r.data);
}

export async function getRuleVersions(ids: string[]): Promise<RuleVersion[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db.query<{ data: RuleVersion }>('SELECT data FROM rc_rules WHERE id = ANY($1::text[])', [ids]);
  const byId = new Map(rows.map((r) => [r.data.id, r.data]));
  return ids.map((id) => byId.get(id)).filter((r): r is RuleVersion => Boolean(r));
}

// ---------- 条文ミニマルペア ----------

export async function insertRulePair(pair: RulePair): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_rule_pairs (id, created_at, data) VALUES ($1, $2, $3::text::jsonb)', [pair.id, pair.createdAt, json(pair)]);
}

export async function updateRulePair(id: string, fn: (p: RulePair) => void): Promise<RulePair | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: RulePair }>('SELECT data FROM rc_rule_pairs WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return null;
    const pair = rows[0].data;
    fn(pair);
    await tx.query('UPDATE rc_rule_pairs SET data = $2::text::jsonb WHERE id = $1', [id, json(pair)]);
    return pair;
  });
}

export async function listRulePairs(): Promise<RulePair[]> {
  const db = await getDb();
  const rows = await db.query<{ data: RulePair }>('SELECT data FROM rc_rule_pairs ORDER BY created_at DESC');
  return rows.map((r) => r.data);
}

// ---------- プロンプト ----------

export async function listPromptSets(): Promise<PromptSet[]> {
  const db = await getDb();
  const rows = await db.query<{ data: PromptSet }>('SELECT data FROM rc_prompt_sets ORDER BY name, version DESC');
  return rows.map((r) => r.data);
}

export async function getPromptSet(id: string): Promise<PromptSet | null> {
  const db = await getDb();
  const rows = await db.query<{ data: PromptSet }>('SELECT data FROM rc_prompt_sets WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

export async function insertNextPromptVersion(build: (version: number) => PromptSet): Promise<PromptSet> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727102)');
    const rows = await tx.query<{ v: number | null }>('SELECT max(version)::int AS v FROM rc_prompt_sets WHERE name = $1', [build(0).name]);
    const p = build((rows[0].v ?? 0) + 1);
    await tx.query('INSERT INTO rc_prompt_sets (id, name, version, created_at, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)', [
      p.id,
      p.name,
      p.version,
      p.createdAt,
      json(p),
    ]);
    return p;
  });
}

// ---------- 研究（多条件実験） ----------

export async function insertStudy(study: Study): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_studies (id, created_at, status, data) VALUES ($1, $2, $3, $4::text::jsonb)', [study.id, study.createdAt, study.status, json(study)]);
}

export async function getStudy(id: string): Promise<Study | null> {
  const db = await getDb();
  const rows = await db.query<{ data: Study }>('SELECT data FROM rc_studies WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

export async function listStudies(): Promise<Study[]> {
  const db = await getDb();
  const rows = await db.query<{ data: Study }>('SELECT data FROM rc_studies ORDER BY created_at DESC LIMIT 500');
  return rows.map((r) => r.data);
}

async function updateStudyIn<T>(q: Queryable, id: string, fn: (s: Study) => T): Promise<T | null> {
  const rows = await q.query<{ data: Study }>('SELECT data FROM rc_studies WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) return null;
  const study = rows[0].data;
  const result = fn(study);
  study.updatedAt = new Date().toISOString();
  await q.query('UPDATE rc_studies SET data = $2::text::jsonb, status = $3 WHERE id = $1', [id, json(study), study.status]);
  return result;
}

export async function updateStudy<T>(id: string, fn: (s: Study) => T): Promise<T | null> {
  const db = await getDb();
  return db.transaction((tx) => updateStudyIn(tx, id, fn));
}

/** 研究の凍結と、全セッションの作成を1つのトランザクションで行う */
export async function startStudyWithSessions(id: string, apply: (s: Study) => void, sessions: Omit<StudySession, 'status' | 'attempts' | 'error' | 'startedAt' | 'finishedAt' | 'finalValue' | 'pnl'>[]): Promise<Study | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const study = await updateStudyIn(tx, id, (s) => {
      apply(s);
      return s;
    });
    if (!study) return null;
    for (const s of sessions) {
      await tx.query(
        `INSERT INTO rc_study_sessions (study_id, condition_id, replicate, seed, order_key, status) VALUES ($1, $2, $3, $4, $5, 'pending')
          ON CONFLICT (study_id, condition_id, replicate) DO NOTHING`,
        [s.studyId, s.conditionId, s.replicate, s.seed, s.orderKey],
      );
    }
    return study;
  });
}

type SessionRow = {
  study_id: string;
  condition_id: string;
  replicate: number;
  seed: string | number;
  order_key: string | number;
  status: StudySession['status'];
  attempts: number;
  data: Partial<StudySession>;
};

const toSession = (r: SessionRow): StudySession => ({
  studyId: r.study_id,
  conditionId: r.condition_id,
  replicate: Number(r.replicate),
  seed: Number(r.seed),
  orderKey: Number(r.order_key),
  status: r.status,
  attempts: Number(r.attempts),
  error: r.data.error ?? null,
  startedAt: r.data.startedAt ?? null,
  finishedAt: r.data.finishedAt ?? null,
  finalValue: r.data.finalValue ?? null,
  pnl: r.data.pnl ?? null,
});

export async function listSessions(studyId: string): Promise<StudySession[]> {
  const db = await getDb();
  const rows = await db.query<SessionRow>('SELECT * FROM rc_study_sessions WHERE study_id = $1 ORDER BY order_key', [studyId]);
  return rows.map(toSession);
}

/**
 * 実行待ちのセッションを排他的に取得する（FOR UPDATE SKIP LOCKED）。
 * 期限切れのリース（ワーカーが止まった場合）も取得対象とし、途中までの記録は削除してやり直す。
 */
export async function claimSessions(studyId: string, owner: string, limit: number, leaseMs: number): Promise<StudySession[]> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<SessionRow>(
      `UPDATE rc_study_sessions s SET status = 'running', lease_owner = $2, lease_until = now() + ($4::int * interval '1 millisecond'),
              attempts = s.attempts + 1, data = s.data || jsonb_build_object('startedAt', to_jsonb(now()::text), 'error', NULL)
        WHERE (s.study_id, s.condition_id, s.replicate) IN (
          SELECT study_id, condition_id, replicate FROM rc_study_sessions
           WHERE study_id = $1 AND (status = 'pending' OR (status = 'running' AND lease_until < now()))
           ORDER BY order_key LIMIT $3 FOR UPDATE SKIP LOCKED)
        RETURNING s.*`,
      [studyId, owner, limit, leaseMs],
    );
    for (const r of rows) {
      await tx.query('DELETE FROM rc_decisions WHERE study_id = $1 AND condition_id = $2 AND replicate = $3', [r.study_id, r.condition_id, r.replicate]);
    }
    return rows.map(toSession);
  });
}

export async function renewSessionLeases(studyId: string, owner: string, leaseMs: number): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE rc_study_sessions SET lease_until = now() + ($3::int * interval '1 millisecond') WHERE study_id = $1 AND lease_owner = $2 AND status = 'running'`,
    [studyId, owner, leaseMs],
  );
}

/** セッションの終了を記録する（担当中のワーカーである場合のみ） */
export async function finishSession(
  s: Pick<StudySession, 'studyId' | 'conditionId' | 'replicate'>,
  owner: string,
  status: 'completed' | 'failed' | 'pending',
  data: Partial<StudySession>,
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE rc_study_sessions SET status = $5, lease_owner = NULL, lease_until = NULL, data = data || $6::text::jsonb
      WHERE study_id = $1 AND condition_id = $2 AND replicate = $3 AND lease_owner = $4 RETURNING 1`,
    [s.studyId, s.conditionId, s.replicate, owner, status, json(data)],
  );
  return rows.length > 0;
}

export async function sessionCounts(studyId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM rc_study_sessions WHERE study_id = $1 GROUP BY status', [studyId]);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function listStudiesNeedingWork(limit = 10): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `SELECT DISTINCT st.id, st.created_at FROM rc_studies st JOIN rc_study_sessions se ON se.study_id = st.id
      WHERE st.status = 'running' AND (se.status = 'pending' OR (se.status = 'running' AND se.lease_until < now()))
      ORDER BY st.created_at LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

// ---------- 意思決定ログ ----------

export async function insertDecisions(records: DecisionRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const d of records) {
      await tx.query(
        `INSERT INTO rc_decisions (study_id, condition_id, replicate, step, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)
          ON CONFLICT (study_id, condition_id, replicate, step) DO NOTHING`,
        [d.studyId, d.conditionId, d.replicate, d.step, json(d)],
      );
    }
  });
}

export async function listDecisions(studyId: string, opts: { conditionId?: string; limit?: number; offset?: number } = {}): Promise<DecisionRecord[]> {
  const db = await getDb();
  const params: unknown[] = [studyId];
  let where = 'study_id = $1';
  if (opts.conditionId) {
    params.push(opts.conditionId);
    where += ` AND condition_id = $${params.length}`;
  }
  params.push(opts.limit ?? 100000, opts.offset ?? 0);
  const rows = await db.query<{ data: DecisionRecord }>(
    `SELECT data FROM rc_decisions WHERE ${where} ORDER BY condition_id, replicate, step LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map((r) => r.data);
}

/**
 * セッションの意思決定ログ保存と完了記録を1つのトランザクションで行う。
 * リースを失っていた（別のワーカーが引き継いだ）場合は何も保存せず false を返す。
 */
export async function completeSession(
  s: Pick<StudySession, 'studyId' | 'conditionId' | 'replicate'>,
  owner: string,
  decisions: DecisionRecord[],
  data: Partial<StudySession>,
): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query(
      `UPDATE rc_study_sessions SET status = 'completed', lease_owner = NULL, lease_until = NULL, data = data || $5::text::jsonb
        WHERE study_id = $1 AND condition_id = $2 AND replicate = $3 AND lease_owner = $4 AND status = 'running' RETURNING 1`,
      [s.studyId, s.conditionId, s.replicate, owner, json(data)],
    );
    if (rows.length === 0) return false;
    for (const d of decisions) {
      await tx.query(
        `INSERT INTO rc_decisions (study_id, condition_id, replicate, step, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)
          ON CONFLICT (study_id, condition_id, replicate, step) DO NOTHING`,
        [d.studyId, d.conditionId, d.replicate, d.step, json(d)],
      );
    }
    return true;
  });
}
