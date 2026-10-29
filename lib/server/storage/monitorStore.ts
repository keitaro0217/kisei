import type { MonitorAlert, MonitorEvent, MonitorSource } from '@/lib/research/monitor-types';
import { getDb } from '../db';

// 監視（試験版）の保存。すべての読み書きをテナント ID で絞り込み、他のテナントのデータにはアクセスしない。

const json = (v: unknown) => JSON.stringify(v);

export async function insertSource(s: MonitorSource, tokenHash: string): Promise<void> {
  const db = await getDb();
  await db.query('INSERT INTO rc_monitor_sources (id, tenant_id, token_hash, created_at, data) VALUES ($1, $2, $3, $4, $5::text::jsonb)', [s.id, s.tenantId, tokenHash, s.createdAt, json(s)]);
}

export async function listSources(tenantId: string): Promise<MonitorSource[]> {
  const db = await getDb();
  return (await db.query<{ data: MonitorSource }>('SELECT data FROM rc_monitor_sources WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId])).map((r) => r.data);
}

export async function getSource(tenantId: string, id: string): Promise<MonitorSource | null> {
  const db = await getDb();
  return (await db.query<{ data: MonitorSource }>('SELECT data FROM rc_monitor_sources WHERE tenant_id = $1 AND id = $2', [tenantId, id]))[0]?.data ?? null;
}

/** トークンのハッシュから接続元を探す（取り込み API の認証） */
export async function getSourceByTokenHash(tokenHash: string): Promise<MonitorSource | null> {
  const db = await getDb();
  return (await db.query<{ data: MonitorSource }>('SELECT data FROM rc_monitor_sources WHERE token_hash = $1', [tokenHash]))[0]?.data ?? null;
}

export async function updateSource(tenantId: string, id: string, fn: (s: MonitorSource) => void): Promise<MonitorSource | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: MonitorSource }>('SELECT data FROM rc_monitor_sources WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!rows[0]) return null;
    const s = rows[0].data;
    fn(s);
    await tx.query('UPDATE rc_monitor_sources SET data = $3::text::jsonb WHERE tenant_id = $1 AND id = $2', [tenantId, id, json(s)]);
    return s;
  });
}

/** 同じ冪等キーのイベントは1度だけ保存する。保存した場合 true */
export async function insertEvent(e: MonitorEvent): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `INSERT INTO rc_monitor_events (id, tenant_id, source_id, idempotency_key, received_at, data) VALUES ($1, $2, $3, $4, $5, $6::text::jsonb)
      ON CONFLICT (source_id, idempotency_key) DO NOTHING RETURNING 1`,
    [e.id, e.tenantId, e.sourceId, e.input.idempotencyKey, e.receivedAt, json(e)],
  );
  return rows.length > 0;
}

export async function listEvents(tenantId: string, opts: { sourceId?: string; limit?: number; flaggedOnly?: boolean } = {}): Promise<MonitorEvent[]> {
  const db = await getDb();
  const params: unknown[] = [tenantId];
  let where = 'tenant_id = $1';
  if (opts.sourceId) {
    params.push(opts.sourceId);
    where += ` AND source_id = $${params.length}`;
  }
  if (opts.flaggedOnly) where += ` AND (data->'result'->>'flagged')::boolean = true`;
  params.push(Math.min(opts.limit ?? 100, 1000));
  return (await db.query<{ data: MonitorEvent }>(`SELECT data FROM rc_monitor_events WHERE ${where} ORDER BY received_at DESC LIMIT $${params.length}`, params)).map((r) => r.data);
}

export async function countEventsSince(sourceId: string, sinceIso: string, judgeSampledOnly = false): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM rc_monitor_events WHERE source_id = $1 AND received_at >= $2${judgeSampledOnly ? ` AND (data->'result'->>'judgeSampled')::boolean = true` : ''}`,
    [sourceId, sinceIso],
  );
  return rows[0].n;
}

export async function purgeEventsOlderThan(sourceId: string, days: number): Promise<number> {
  const db = await getDb();
  return (await db.query(`DELETE FROM rc_monitor_events WHERE source_id = $1 AND received_at < now() - ($2::int * interval '1 day') RETURNING 1`, [sourceId, days])).length;
}

export async function listAlerts(tenantId: string, opts: { sourceId?: string; status?: MonitorAlert['status'] } = {}): Promise<MonitorAlert[]> {
  const db = await getDb();
  const params: unknown[] = [tenantId];
  let where = 'tenant_id = $1';
  if (opts.sourceId) {
    params.push(opts.sourceId);
    where += ` AND source_id = $${params.length}`;
  }
  if (opts.status) {
    params.push(opts.status);
    where += ` AND status = $${params.length}`;
  }
  return (await db.query<{ data: MonitorAlert }>(`SELECT data FROM rc_monitor_alerts WHERE ${where} ORDER BY created_at DESC LIMIT 500`, params)).map((r) => r.data);
}

/** 同じ種類・同じ鍵の未解決の警告がなければ作る（警告の重複を防ぐ）。作成した場合 true */
export async function openAlertIfAbsent(a: MonitorAlert): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727201)');
    const existing = await tx.query(
      `SELECT 1 FROM rc_monitor_alerts WHERE source_id = $1 AND status <> 'resolved' AND data->>'type' = $2 AND data->>'key' = $3`,
      [a.sourceId, a.type, a.key],
    );
    if (existing.length) return false;
    await tx.query('INSERT INTO rc_monitor_alerts (id, tenant_id, source_id, created_at, status, data) VALUES ($1, $2, $3, $4, $5, $6::text::jsonb)', [a.id, a.tenantId, a.sourceId, a.createdAt, a.status, json(a)]);
    return true;
  });
}

export async function updateAlert(tenantId: string, id: string, fn: (a: MonitorAlert) => void): Promise<MonitorAlert | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ data: MonitorAlert }>('SELECT data FROM rc_monitor_alerts WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!rows[0]) return null;
    const a = rows[0].data;
    fn(a);
    await tx.query('UPDATE rc_monitor_alerts SET data = $3::text::jsonb, status = $4 WHERE tenant_id = $1 AND id = $2', [tenantId, id, json(a), a.status]);
    return a;
  });
}
