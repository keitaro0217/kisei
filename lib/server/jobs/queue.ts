import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { safeMessage } from '../security/redact';
import { log } from '../log';

// バックグラウンドジョブ（PostgreSQL のキュー）。
// - 取得は FOR UPDATE SKIP LOCKED とリースで排他する（複数のワーカー・関数実行が同時に動いても二重に処理しない）。
// - ワーカーが止まってリースが切れたジョブは、次のワーカーが取り直す（試行回数に数える）。
// - 失敗は指数バックオフで再試行し、上限回数に達したら failed にする（連続で再試行し続けない）。
// - 冪等キーで同じジョブの重複登録を防ぐ。
// 状態の遷移: queued → running → succeeded | failed | cancelled（running → queued は再試行）。DB の CHECK 制約でも整合性を保つ。

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type Job = {
  id: string;
  kind: string;
  status: JobStatus;
  idempotencyKey: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastError: string | null;
  payload: Record<string, unknown>;
  result: unknown;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type JobRow = {
  id: string;
  kind: string;
  status: JobStatus;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
  run_after: Date | string;
  last_error: string | null;
  payload: Record<string, unknown>;
  result: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
};

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
const toJob = (r: JobRow): Job => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  idempotencyKey: r.idempotency_key,
  attempts: Number(r.attempts),
  maxAttempts: Number(r.max_attempts),
  runAfter: iso(r.run_after)!,
  lastError: r.last_error,
  payload: r.payload ?? {},
  result: r.result ?? null,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  finishedAt: iso(r.finished_at),
});

/** 再試行までの待ち時間（30秒・2分・8分…、最大1時間） */
export const backoffMs = (attempt: number) => Math.min(60 * 60_000, 30_000 * 4 ** Math.max(0, attempt - 1));

export async function enqueueJob(input: { kind: string; payload?: Record<string, unknown>; idempotencyKey?: string; maxAttempts?: number; delayMs?: number; projectId?: string }): Promise<Job> {
  const db = await getDb();
  const rows = await db.query<JobRow>(
    `INSERT INTO rc_jobs (id, project_id, kind, status, idempotency_key, max_attempts, run_after, payload)
       VALUES ($1, $2, $3, 'queued', $4, $5, now() + ($6::int * interval '1 millisecond'), $7::text::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [randomUUID(), input.projectId ?? 'default', input.kind, input.idempotencyKey ?? null, input.maxAttempts ?? 3, input.delayMs ?? 0, JSON.stringify(input.payload ?? {})],
  );
  if (rows[0]) return toJob(rows[0]);
  // 同じ冪等キーのジョブが登録済み
  return toJob((await db.query<JobRow>('SELECT * FROM rc_jobs WHERE idempotency_key = $1', [input.idempotencyKey]))[0]);
}

/** 実行できるジョブを排他的に取得する（期限切れのリースも取り直す） */
export async function claimJobs(owner: string, limit: number, leaseMs: number, kinds?: string[]): Promise<Job[]> {
  const db = await getDb();
  const rows = await db.query<JobRow>(
    `UPDATE rc_jobs j SET status = 'running', lease_owner = $1, lease_until = now() + ($3::int * interval '1 millisecond'),
            attempts = j.attempts + 1, updated_at = now()
      WHERE j.id IN (
        SELECT id FROM rc_jobs
         WHERE ((status = 'queued' AND run_after <= now()) OR (status = 'running' AND lease_until < now()))
           AND ($4::text[] IS NULL OR kind = ANY($4::text[]))
         ORDER BY run_after LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING j.*`,
    [owner, limit, leaseMs, kinds ?? null],
  );
  return rows.map(toJob);
}

/** 成功を記録する（担当中のワーカーである場合のみ） */
export async function completeJob(id: string, owner: string, result: unknown): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE rc_jobs SET status = 'succeeded', result = $3::text::jsonb, lease_owner = NULL, lease_until = NULL, last_error = NULL, finished_at = now(), updated_at = now()
      WHERE id = $1 AND lease_owner = $2 AND status = 'running' RETURNING 1`,
    [id, owner, JSON.stringify(result ?? null)],
  );
  return rows.length > 0;
}

/** 失敗を記録する。上限回数までは待ち時間をおいて再試行し、超えたら failed にする */
export async function failJob(id: string, owner: string, error: unknown): Promise<JobStatus | null> {
  const db = await getDb();
  const message = safeMessage(error).slice(0, 2000);
  const rows = await db.query<{ status: JobStatus; attempts: number; max_attempts: number }>(
    `UPDATE rc_jobs SET
        status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
        run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE now() + (least(3600000, $4::bigint * power(4, greatest(attempts - 1, 0)))::bigint * interval '1 millisecond') END,
        finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
        lease_owner = NULL, lease_until = NULL, last_error = $3, updated_at = now()
      WHERE id = $1 AND lease_owner = $2 AND status = 'running'
      RETURNING status, attempts, max_attempts`,
    [id, owner, message, 30_000],
  );
  return rows[0]?.status ?? null;
}

/** 待機中・実行中のジョブを取り消す（実行中のジョブは、結果を記録できなくなる） */
export async function cancelJob(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE rc_jobs SET status = 'cancelled', lease_owner = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'running') RETURNING 1`,
    [id],
  );
  return rows.length > 0;
}

/** 失敗したジョブをやり直す（試行回数を戻す） */
export async function retryJob(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE rc_jobs SET status = 'queued', attempts = 0, run_after = now(), finished_at = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('failed', 'cancelled') RETURNING 1`,
    [id],
  );
  return rows.length > 0;
}

/** 一覧（新しい順、カーソルによるページネーション） */
export async function listJobs(opts: { status?: JobStatus; limit?: number; before?: string } = {}): Promise<{ jobs: Job[]; nextCursor: string | null }> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await db.query<JobRow>(
    `SELECT * FROM rc_jobs WHERE ($1::text IS NULL OR status = $1) AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
      ORDER BY created_at DESC LIMIT $3`,
    [opts.status ?? null, opts.before ?? null, limit + 1],
  );
  const jobs = rows.slice(0, limit).map(toJob);
  return { jobs, nextCursor: rows.length > limit ? jobs[jobs.length - 1].createdAt : null };
}

export async function jobCounts(): Promise<Record<JobStatus, number> & { stuck: number }> {
  const db = await getDb();
  const rows = await db.query<{ status: JobStatus; n: string | number }>('SELECT status, count(*) AS n FROM rc_jobs GROUP BY status');
  const stuck = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM rc_jobs WHERE status = 'running' AND lease_until < now()`);
  const out = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, stuck: Number(stuck[0]?.n ?? 0) };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

// ---- 実行 ----

export type JobHandler = (job: Job) => Promise<unknown>;
const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: string, handler: JobHandler) {
  handlers.set(kind, handler);
}

/** 期限までジョブを処理する。処理したジョブの数を返す */
export async function runJobs(deadline: number, opts: { owner?: string; leaseMs?: number; batch?: number } = {}): Promise<number> {
  const owner = opts.owner ?? `jobs-${randomUUID()}`;
  const leaseMs = opts.leaseMs ?? 5 * 60_000;
  let processed = 0;
  while (Date.now() < deadline) {
    const kinds = [...handlers.keys()];
    if (kinds.length === 0) break;
    const jobs = await claimJobs(owner, opts.batch ?? 5, leaseMs, kinds);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const handler = handlers.get(job.kind)!;
      try {
        const result = await handler(job);
        await completeJob(job.id, owner, result);
        log.info('job.succeeded', { jobId: job.id, kind: job.kind, attempts: job.attempts });
      } catch (e) {
        const status = await failJob(job.id, owner, e);
        log[status === 'failed' ? 'error' : 'warn'](status === 'failed' ? 'job.failed' : 'job.retry_scheduled', { jobId: job.id, kind: job.kind, attempts: job.attempts, error: safeMessage(e) });
      }
      processed++;
    }
  }
  return processed;
}
