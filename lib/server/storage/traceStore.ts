import type { TraceRecord, TraceSummary } from '@/lib/research/trace-types';
import { getDb, type Queryable } from '../db';

// 実行トレースの保存。検索に使う属性は列に、Span の本体は jsonb に保存する。

const json = (v: unknown) => JSON.stringify(v);

export type TraceFlags = { hasViolation: boolean; hasDeviation: boolean; hasBoundary: boolean; model: string | null };

/** 同じセッションのトレースは上書きする（再実行時は最新の実行のみを残す） */
export async function upsertTraceIn(q: Queryable, t: TraceRecord, f: TraceFlags): Promise<void> {
  await q.query(
    `INSERT INTO rc_traces (study_id, condition_id, replicate, trace_id, started_at, duration_ms, status, span_count, has_error, has_violation, has_deviation, has_boundary, model, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::text::jsonb)
     ON CONFLICT (study_id, condition_id, replicate) DO UPDATE SET
       trace_id = EXCLUDED.trace_id, started_at = EXCLUDED.started_at, duration_ms = EXCLUDED.duration_ms, status = EXCLUDED.status,
       span_count = EXCLUDED.span_count, has_error = EXCLUDED.has_error, has_violation = EXCLUDED.has_violation,
       has_deviation = EXCLUDED.has_deviation, has_boundary = EXCLUDED.has_boundary, model = EXCLUDED.model, data = EXCLUDED.data`,
    [t.studyId, t.conditionId, t.replicate, t.traceId, t.startedAt, Math.round(t.durationMs), t.status, t.spans.length, t.status === 'ERROR', f.hasViolation, f.hasDeviation, f.hasBoundary, f.model, json(t)],
  );
}

export async function upsertTrace(t: TraceRecord, f: TraceFlags): Promise<void> {
  await upsertTraceIn(await getDb(), t, f);
}

export type TraceFilter = {
  studyId?: string;
  conditionId?: string;
  replicate?: number;
  model?: string;
  status?: 'OK' | 'ERROR';
  hasViolation?: boolean;
  hasDeviation?: boolean;
  hasBoundary?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

type Row = {
  study_id: string;
  condition_id: string;
  replicate: number;
  trace_id: string;
  started_at: string | Date;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  span_count: number;
  has_error: boolean;
  has_violation: boolean;
  has_deviation: boolean;
  has_boundary: boolean;
  model: string | null;
  payload_mode: string;
  truncated: boolean | null;
};

export async function listTraces(f: TraceFilter): Promise<TraceSummary[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.studyId) add('study_id = ?', f.studyId);
  if (f.conditionId) add('condition_id = ?', f.conditionId);
  if (f.replicate !== undefined) add('replicate = ?', f.replicate);
  if (f.model) add('model = ?', f.model);
  if (f.status) add('status = ?', f.status);
  if (f.hasViolation !== undefined) add('has_violation = ?', f.hasViolation);
  if (f.hasDeviation !== undefined) add('has_deviation = ?', f.hasDeviation);
  if (f.hasBoundary !== undefined) add('has_boundary = ?', f.hasBoundary);
  if (f.from) add('started_at >= ?::timestamptz', f.from);
  if (f.to) add('started_at <= ?::timestamptz', f.to);
  params.push(Math.min(f.limit ?? 50, 500), f.offset ?? 0);
  const rows = await db.query<Row>(
    `SELECT study_id, condition_id, replicate, trace_id, started_at, duration_ms, status, span_count, has_error, has_violation, has_deviation, has_boundary, model,
            data->>'payloadMode' AS payload_mode, (data->>'truncated')::boolean AS truncated
       FROM rc_traces ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    traceId: r.trace_id,
    studyId: r.study_id,
    conditionId: r.condition_id,
    replicate: Number(r.replicate),
    payloadMode: r.payload_mode as TraceSummary['payloadMode'],
    startedAt: new Date(r.started_at).toISOString(),
    durationMs: Number(r.duration_ms),
    status: r.status,
    truncated: Boolean(r.truncated),
    spanCount: Number(r.span_count),
    hasError: r.has_error,
    hasViolation: r.has_violation,
    hasDeviation: r.has_deviation,
    hasBoundary: r.has_boundary,
    model: r.model,
  }));
}

export async function getTrace(traceId: string): Promise<TraceRecord | null> {
  const db = await getDb();
  const rows = await db.query<{ data: TraceRecord }>('SELECT data FROM rc_traces WHERE trace_id = $1', [traceId]);
  return rows[0]?.data ?? null;
}

export async function getTraceForSession(studyId: string, conditionId: string, replicate: number): Promise<TraceRecord | null> {
  const db = await getDb();
  const rows = await db.query<{ data: TraceRecord }>('SELECT data FROM rc_traces WHERE study_id = $1 AND condition_id = $2 AND replicate = $3', [studyId, conditionId, replicate]);
  return rows[0]?.data ?? null;
}

/** 保存期間を過ぎたトレースを削除する。削除した件数を返す */
export async function purgeTracesOlderThan(days: number): Promise<number> {
  const db = await getDb();
  const rows = await db.query(`DELETE FROM rc_traces WHERE started_at < now() - ($1::int * interval '1 day') RETURNING 1`, [days]);
  return rows.length;
}
