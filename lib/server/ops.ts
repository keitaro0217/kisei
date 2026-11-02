import { getDb } from './db';
import { MIGRATIONS } from './db/schema';
import { jobCounts, listJobs } from './jobs/queue';
import { verifyAuditChain } from './storage/store';
import { studyLiveness } from './storage/studyStore';

// 運用状況（ログイン後の管理画面用）。値に秘密情報（接続文字列・キー）は含めない。

/** 公開のヘルスチェック: データベースに接続できるかだけを返す（構成の詳細は出さない） */
export async function healthCheck(): Promise<{ ok: boolean; database: 'ok' | 'error' }> {
  try {
    const db = await getDb();
    await db.query('SELECT 1');
    return { ok: true, database: 'ok' };
  } catch {
    return { ok: false, database: 'error' };
  }
}

export async function operationsStatus() {
  const db = await getDb();
  const t0 = Date.now();
  await db.query('SELECT 1');
  const latencyMs = Date.now() - t0;
  const applied = (await db.query<{ id: string; applied_at: Date | string }>('SELECT id, applied_at FROM rc_schema_migrations ORDER BY id')).map((r) => ({
    id: r.id,
    appliedAt: new Date(r.applied_at).toISOString(),
  }));
  const pending = MIGRATIONS.map((m) => m.id).filter((id) => !applied.some((a) => a.id === id));
  const running = await db.query<{ id: string; title: string }>(`SELECT id, data->'design'->>'title' AS title FROM rc_studies WHERE status = 'running' ORDER BY created_at DESC LIMIT 50`);
  const studies = [];
  for (const s of running) studies.push({ id: s.id, title: s.title, ...(await studyLiveness(s.id)) });
  const sizes = await db.query<{ table: string; rows: string | number }>(
    `SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables WHERE relname LIKE 'rc\\_%' ORDER BY n_live_tup DESC LIMIT 20`,
  );
  return {
    database: { kind: db.kind, latencyMs, migrations: applied, pendingMigrations: pending },
    jobs: { counts: await jobCounts(), recentFailed: (await listJobs({ status: 'failed', limit: 10 })).jobs },
    studies: { running: studies.length, stalled: studies.filter((s) => s.state === 'stalled') , all: studies },
    audit: await verifyAuditChain(),
    tables: sizes.map((r) => ({ table: r.table, rows: Number(r.rows) })),
    checkedAt: new Date().toISOString(),
  };
}
