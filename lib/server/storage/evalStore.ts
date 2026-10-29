import type { Annotation, EvalRun, JudgeVerdict } from '@/lib/research/eval-types';
import { getDb } from '../db';

// 評価（Judge の実行・判断ごとの評価・人の評価）の保存。

const json = (v: unknown) => JSON.stringify(v);

export async function insertEvalRun(run: EvalRun): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_eval_runs (id, study_id, created_at, status, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)', [run.id, run.studyId, run.createdAt, run.status, json(run)]);
}

export async function getEvalRun(id: string): Promise<EvalRun | null> {
  const db = await getDb();
  const rows = await db.query<{ data: EvalRun }>('SELECT data FROM rc_eval_runs WHERE id = $1', [id]);
  return rows[0]?.data ?? null;
}

export async function listEvalRuns(studyId: string): Promise<EvalRun[]> {
  const db = await getDb();
  const rows = await db.query<{ data: EvalRun }>('SELECT data FROM rc_eval_runs WHERE study_id = $1 ORDER BY created_at', [studyId]);
  return rows.map((r) => r.data);
}

export async function updateEvalRun<T>(id: string, fn: (r: EvalRun) => T): Promise<T | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: EvalRun }>('SELECT data FROM rc_eval_runs WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return null;
    const run = rows[0].data;
    const out = fn(run);
    await tx.query('UPDATE rc_eval_runs SET data = $2::text::jsonb, status = $3 WHERE id = $1', [id, json(run), run.status]);
    return out;
  });
}

/** 評価の実行の担当権（リース）を取得する。他のワーカーが担当中なら false */
export async function acquireEvalLease(id: string, owner: string, ms: number): Promise<boolean> {
  const ok = await updateEvalRun(id, (r) => {
    if (r.status !== 'running') return false;
    if (r.leaseOwner && r.leaseUntil && Date.parse(r.leaseUntil) > Date.now() && r.leaseOwner !== owner) return false;
    r.leaseOwner = owner;
    r.leaseUntil = new Date(Date.now() + ms).toISOString();
    return true;
  });
  return ok === true;
}

export async function releaseEvalLease(id: string, owner: string): Promise<void> {
  await updateEvalRun(id, (r) => {
    if (r.leaseOwner === owner) {
      r.leaseOwner = null;
      r.leaseUntil = null;
    }
  });
}

export async function listRunningEvalRuns(limit = 10): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(`SELECT id FROM rc_eval_runs WHERE status = 'running' ORDER BY created_at LIMIT $1`, [limit]);
  return rows.map((r) => r.id);
}

export async function insertJudgement(runId: string, key: { conditionId: string; replicate: number; step: number }, v: JudgeVerdict): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `INSERT INTO rc_judgements (run_id, condition_id, replicate, step, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)
      ON CONFLICT (run_id, condition_id, replicate, step) DO NOTHING RETURNING 1`,
    [runId, key.conditionId, key.replicate, key.step, json(v)],
  );
  return rows.length > 0;
}

export type StoredJudgement = { runId: string; conditionId: string; replicate: number; step: number; verdict: JudgeVerdict };

export async function listJudgementsForStudy(studyId: string): Promise<StoredJudgement[]> {
  const db = await getDb();
  const rows = await db.query<{ run_id: string; condition_id: string; replicate: number; step: number; data: JudgeVerdict }>(
    `SELECT j.run_id, j.condition_id, j.replicate, j.step, j.data FROM rc_judgements j JOIN rc_eval_runs r ON r.id = j.run_id WHERE r.study_id = $1`,
    [studyId],
  );
  return rows.map((r) => ({ runId: r.run_id, conditionId: r.condition_id, replicate: Number(r.replicate), step: Number(r.step), verdict: r.data }));
}

export async function judgedKeys(runId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.query<{ k: string }>(`SELECT condition_id || '/' || replicate || '/' || step AS k FROM rc_judgements WHERE run_id = $1`, [runId]);
  return new Set(rows.map((r) => r.k));
}

/** 人の評価を保存する（同じ評価者の再評価は上書きし、以前の内容を履歴に残す） */
export async function upsertAnnotation(a: Omit<Annotation, 'history' | 'updatedAt'>): Promise<Annotation> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: Annotation }>(
      'SELECT data FROM rc_annotations WHERE study_id = $1 AND condition_id = $2 AND replicate = $3 AND step = $4 AND annotator = $5 FOR UPDATE',
      [a.studyId, a.conditionId, a.replicate, a.step, a.annotator],
    );
    const prev = rows[0]?.data;
    const now = new Date().toISOString();
    const next: Annotation = {
      ...a,
      updatedAt: now,
      history: prev ? [...prev.history, { intent: prev.intent, formalCorrect: prev.formalCorrect, reason: prev.reason, at: prev.updatedAt }].slice(-50) : [],
    };
    await tx.query(
      `INSERT INTO rc_annotations (study_id, condition_id, replicate, step, annotator, updated_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb)
        ON CONFLICT (study_id, condition_id, replicate, step, annotator) DO UPDATE SET updated_at = EXCLUDED.updated_at, data = EXCLUDED.data`,
      [a.studyId, a.conditionId, a.replicate, a.step, a.annotator, now, json(next)],
    );
    return next;
  });
}

export async function listAnnotations(studyId: string): Promise<Annotation[]> {
  const db = await getDb();
  const rows = await db.query<{ data: Annotation }>('SELECT data FROM rc_annotations WHERE study_id = $1 ORDER BY updated_at', [studyId]);
  return rows.map((r) => r.data);
}
