import type { Patch, RegressionRun } from '@/lib/research/patch-types';
import { getDb } from '../db';

// 修正案と回帰テストの実行の保存。

const json = (v: unknown) => JSON.stringify(v);

export async function insertPatch(p: Patch): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_patches (id, created_at, status, data) VALUES ($1, $2, $3, $4::text::jsonb)', [p.id, p.createdAt, p.status, json(p)]);
}

export async function getPatch(id: string): Promise<Patch | null> {
  const db = await getDb();
  const rows = await db.query<{ data: Patch }>('SELECT data FROM rc_patches WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

export async function listPatches(): Promise<Patch[]> {
  const db = await getDb();
  const rows = await db.query<{ data: Patch }>('SELECT data FROM rc_patches ORDER BY created_at DESC LIMIT 1000');
  return rows.map((r) => r.data);
}

export async function updatePatch<T>(id: string, fn: (p: Patch) => T | Promise<T>): Promise<T | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: Patch }>('SELECT data FROM rc_patches WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return null;
    const p = rows[0].data;
    const out = await fn(p);
    await tx.query('UPDATE rc_patches SET data = $2::text::jsonb, status = $3 WHERE id = $1', [id, json(p), p.status]);
    return out;
  });
}

export async function insertRegressionRun(r: RegressionRun): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_regression_runs (id, patch_id, created_at, data) VALUES ($1, $2, $3, $4::text::jsonb)', [r.id, r.patchId, r.createdAt, json(r)]);
}

export async function listRegressionRuns(patchId?: string): Promise<RegressionRun[]> {
  const db = await getDb();
  const rows = patchId
    ? await db.query<{ data: RegressionRun }>('SELECT data FROM rc_regression_runs WHERE patch_id = $1 ORDER BY created_at DESC', [patchId])
    : await db.query<{ data: RegressionRun }>('SELECT data FROM rc_regression_runs ORDER BY created_at DESC LIMIT 2000');
  return rows.map((r) => r.data);
}

export async function updateRegressionRun(id: string, fn: (r: RegressionRun) => void): Promise<RegressionRun | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: RegressionRun }>('SELECT data FROM rc_regression_runs WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return null;
    const r = rows[0].data;
    fn(r);
    await tx.query('UPDATE rc_regression_runs SET data = $2::text::jsonb WHERE id = $1', [id, json(r)]);
    return r;
  });
}
