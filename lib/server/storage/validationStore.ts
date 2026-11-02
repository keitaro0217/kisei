import { randomUUID } from 'node:crypto';
import type { EvalCategory, GoldLabel, LabelSet, LabelSetPurpose, ReviewState } from '@/lib/research/evaluation-model';
import { getDb } from '../db';

// 評価のレビュー（追記のみ）と、外部ラベル付きデータセットの保存。

export type EvaluationReview = {
  id: string;
  studyId: string;
  itemKey: string;
  evaluatorId: string;
  action: 'approve' | 'correct' | 'reject';
  correctedCategory: EvalCategory | null;
  reviewer: string;
  note: string;
  at: string;
};

type ReviewRow = { id: string; study_id: string; item_key: string; evaluator_id: string; action: EvaluationReview['action']; corrected_category: EvalCategory | null; reviewer: string; note: string; at: Date | string };
const toReview = (r: ReviewRow): EvaluationReview => ({
  id: r.id,
  studyId: r.study_id,
  itemKey: r.item_key,
  evaluatorId: r.evaluator_id,
  action: r.action,
  correctedCategory: r.corrected_category,
  reviewer: r.reviewer,
  note: r.note,
  at: new Date(r.at).toISOString(),
});

export async function insertReview(r: Omit<EvaluationReview, 'id' | 'at'>): Promise<EvaluationReview> {
  const db = await getDb();
  const rows = await db.query<ReviewRow>(
    `INSERT INTO rc_evaluation_reviews (id, study_id, item_key, evaluator_id, action, corrected_category, reviewer, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [randomUUID(), r.studyId, r.itemKey, r.evaluatorId, r.action, r.correctedCategory, r.reviewer, r.note],
  );
  return toReview(rows[0]);
}

/** レビューの履歴（古い順）。最新のものが現在の状態 */
export async function listReviews(studyId: string): Promise<EvaluationReview[]> {
  const db = await getDb();
  return (await db.query<ReviewRow>('SELECT * FROM rc_evaluation_reviews WHERE study_id = $1 ORDER BY at, id', [studyId])).map(toReview);
}

export const reviewStateOf = (action: EvaluationReview['action']): ReviewState => (action === 'approve' ? 'approved' : action === 'correct' ? 'corrected' : 'rejected');

// ---------- ラベル付きデータセット ----------

type SetRow = { id: string; name: string; version: number; purpose: LabelSetPurpose; frozen: boolean; created_at: Date | string; data: { description: string; source: string; guidelineVersion: string; createdBy: string } };

async function toSet(r: SetRow): Promise<LabelSet> {
  const db = await getDb();
  const stats = await db.query<{ n: number; annotators: string[] | null }>(`SELECT count(*)::int AS n, array_agg(DISTINCT annotator) AS annotators FROM rc_labels WHERE set_id = $1`, [r.id]);
  return {
    id: r.id,
    name: r.name,
    version: Number(r.version),
    purpose: r.purpose,
    frozen: r.frozen,
    description: r.data.description,
    source: r.data.source,
    guidelineVersion: r.data.guidelineVersion,
    createdBy: r.data.createdBy,
    createdAt: new Date(r.created_at).toISOString(),
    labelCount: Number(stats[0]?.n ?? 0),
    annotators: (stats[0]?.annotators ?? []).filter(Boolean),
  };
}

export async function insertLabelSet(input: { name: string; purpose: LabelSetPurpose; description: string; source: string; guidelineVersion: string; createdBy: string }): Promise<LabelSet> {
  const db = await getDb();
  const rows = await db.transaction(async (tx) => {
    // 同じ名前の次の版
    const v = await tx.query<{ v: number | null }>(`SELECT max(version) AS v FROM rc_label_sets WHERE project_id = 'default' AND name = $1`, [input.name]);
    const version = Number(v[0]?.v ?? 0) + 1;
    return tx.query<SetRow>(
      `INSERT INTO rc_label_sets (id, name, version, purpose, data) VALUES ($1, $2, $3, $4, $5::text::jsonb) RETURNING *`,
      [randomUUID(), input.name, version, input.purpose, JSON.stringify({ description: input.description, source: input.source, guidelineVersion: input.guidelineVersion, createdBy: input.createdBy })],
    );
  });
  return toSet(rows[0]);
}

export async function getLabelSet(id: string): Promise<LabelSet | null> {
  const db = await getDb();
  const rows = await db.query<SetRow>('SELECT * FROM rc_label_sets WHERE id = $1', [id]);
  return rows[0] ? toSet(rows[0]) : null;
}

export async function listLabelSets(): Promise<LabelSet[]> {
  const db = await getDb();
  const rows = await db.query<SetRow>('SELECT * FROM rc_label_sets ORDER BY name, version DESC LIMIT 200');
  return Promise.all(rows.map(toSet));
}

export async function freezeLabelSet(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query('UPDATE rc_label_sets SET frozen = true WHERE id = $1 AND NOT frozen RETURNING 1', [id])).length > 0;
}

export async function upsertLabels(setId: string, labels: Omit<GoldLabel, 'setId' | 'itemKey' | 'at'>[]): Promise<number> {
  if (labels.length === 0) return 0;
  const db = await getDb();
  return db.transaction(async (tx) => {
    let n = 0;
    for (const l of labels) {
      await tx.query(
        `INSERT INTO rc_labels (set_id, study_id, condition_id, replicate, step, annotator, category, formal, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (set_id, study_id, condition_id, replicate, step, annotator) DO UPDATE SET category = EXCLUDED.category, formal = EXCLUDED.formal, note = EXCLUDED.note, at = now()`,
        [setId, l.target.studyId, l.target.conditionId, l.target.replicate, l.target.step, l.annotator, l.category, l.formal, l.note],
      );
      n++;
    }
    return n;
  });
}

type LabelRow = { set_id: string; study_id: string; condition_id: string; replicate: number; step: number; annotator: string; category: EvalCategory; formal: 'compliant' | 'violation' | null; note: string; at: Date | string };

export async function listLabels(setId: string, studyId?: string): Promise<GoldLabel[]> {
  const db = await getDb();
  const rows = await db.query<LabelRow>(
    `SELECT * FROM rc_labels WHERE set_id = $1 AND ($2::text IS NULL OR study_id = $2) ORDER BY study_id, condition_id, replicate, step, annotator`,
    [setId, studyId ?? null],
  );
  return rows.map((r) => {
    const target = { studyId: r.study_id, conditionId: r.condition_id, replicate: Number(r.replicate), step: Number(r.step) };
    return { setId: r.set_id, target, itemKey: `${target.studyId}/${target.conditionId}/${target.replicate}/${target.step}`, annotator: r.annotator, category: r.category, formal: r.formal, note: r.note, at: new Date(r.at).toISOString() };
  });
}
