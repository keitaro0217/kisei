import type { Failure, Hypothesis, TestCase, TestCaseStatus, TestDataset } from '@/lib/research/failure-types';
import { getDb } from '../db';

// Failure・回帰テストケース・原因仮説の保存。

const json = (v: unknown) => JSON.stringify(v);

/** 判断ごとに1件。同じ判断を再検出しても重複しない。追加した件数を返す */
export async function insertFailures(items: Failure[]): Promise<number> {
  if (items.length === 0) return 0;
  const db = await getDb();
  return db.transaction(async (tx) => {
    let added = 0;
    for (const f of items) {
      const rows = await tx.query(
        `INSERT INTO rc_failures (id, study_id, condition_id, replicate, step, fingerprint, created_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb)
          ON CONFLICT (study_id, condition_id, replicate, step) DO NOTHING RETURNING 1`,
        [f.id, f.studyId, f.conditionId, f.replicate, f.step, f.fingerprint, f.createdAt, json(f)],
      );
      added += rows.length;
    }
    return added;
  });
}

export async function listFailures(filter: { fingerprint?: string; studyId?: string; limit?: number } = {}): Promise<Failure[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.fingerprint) {
    params.push(filter.fingerprint);
    where.push(`fingerprint = $${params.length}`);
  }
  if (filter.studyId) {
    params.push(filter.studyId);
    where.push(`study_id = $${params.length}`);
  }
  params.push(Math.min(filter.limit ?? 20_000, 20_000));
  const rows = await db.query<{ data: Failure }>(`SELECT data FROM rc_failures ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, study_id, condition_id, replicate, step LIMIT $${params.length}`, params);
  return rows.map((r) => r.data);
}

export async function getFailure(id: string): Promise<Failure | null> {
  const db = await getDb();
  const rows = await db.query<{ data: Failure }>('SELECT data FROM rc_failures WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

export async function updateFailure(id: string, fn: (f: Failure) => void): Promise<Failure | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: Failure }>('SELECT data FROM rc_failures WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return null;
    const f = rows[0].data;
    fn(f);
    await tx.query('UPDATE rc_failures SET data = $2::text::jsonb WHERE id = $1', [id, json(f)]);
    return f;
  });
}

// ---------- テストケース ----------

/** 同じ元（sourceKey）からは1件だけ作る。作成した場合 true */
export async function insertTestCase(t: TestCase): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `INSERT INTO rc_test_cases (id, source_key, fingerprint, dataset, status, created_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb)
      ON CONFLICT (source_key) DO NOTHING RETURNING 1`,
    [t.id, t.sourceKey, t.fingerprint, t.dataset, t.status, t.createdAt, json(t)],
  );
  return rows.length > 0;
}

export async function listTestCases(filter: { dataset?: TestDataset; status?: TestCaseStatus; fingerprint?: string } = {}): Promise<TestCase[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [col, v] of [
    ['dataset', filter.dataset],
    ['status', filter.status],
    ['fingerprint', filter.fingerprint],
  ] as const) {
    if (v) {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    }
  }
  const rows = await db.query<{ data: TestCase }>(`SELECT data FROM rc_test_cases ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at LIMIT 10000`, params);
  return rows.map((r) => r.data);
}

export async function updateTestCase(id: string, fn: (t: TestCase) => void): Promise<TestCase | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: TestCase }>('SELECT data FROM rc_test_cases WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return null;
    const t = rows[0].data;
    fn(t);
    await tx.query('UPDATE rc_test_cases SET data = $2::text::jsonb, status = $3, dataset = $4 WHERE id = $1', [id, json(t), t.status, t.dataset]);
    return t;
  });
}

// ---------- 原因仮説 ----------

export async function insertHypothesis(h: Hypothesis): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_hypotheses (id, fingerprint, created_at, status, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)', [h.id, h.fingerprint, h.createdAt, h.status, json(h)]);
}

export async function listHypotheses(fingerprint?: string): Promise<Hypothesis[]> {
  const db = await getDb();
  const rows = fingerprint
    ? await db.query<{ data: Hypothesis }>('SELECT data FROM rc_hypotheses WHERE fingerprint = $1 ORDER BY created_at', [fingerprint])
    : await db.query<{ data: Hypothesis }>('SELECT data FROM rc_hypotheses ORDER BY created_at DESC LIMIT 1000');
  return rows.map((r) => r.data);
}

export async function getHypothesis(id: string): Promise<Hypothesis | null> {
  const db = await getDb();
  const rows = await db.query<{ data: Hypothesis }>('SELECT data FROM rc_hypotheses WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

export async function updateHypothesis<T>(id: string, fn: (h: Hypothesis) => T): Promise<T | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: Hypothesis }>('SELECT data FROM rc_hypotheses WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return null;
    const h = rows[0].data;
    const out = fn(h);
    await tx.query('UPDATE rc_hypotheses SET data = $2::text::jsonb, status = $3 WHERE id = $1', [id, json(h), h.status]);
    return out;
  });
}
