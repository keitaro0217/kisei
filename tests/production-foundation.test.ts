import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// 本番運用の基盤: 既存のデータを持つ DB からの安全な移行、監査ログの改ざん検知と不変化、
// 研究結果の不変化、状態の整合性制約、ジョブキュー（排他・再試行・冪等・取消）、構造化ログの伏せ字。

type Q = { query: (sql: string, params?: unknown[]) => Promise<unknown[]>; close: () => Promise<void> };

/** 移行前のスキーマ（前回までのマイグレーション）を直接適用し、既存のデータを入れておく */
async function legacyDb(): Promise<Q> {
  const { SCHEMA_STATEMENTS, MIGRATIONS } = await import('@/lib/server/db/schema');
  let q: Q;
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    q = { query: (t, p) => sql.unsafe(t, (p ?? []) as never[]) as never, close: () => sql.end() };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(path.resolve(process.cwd(), process.env.RESEARCH_DATA_DIR!, 'pglite'));
    await db.waitReady;
    q = { query: async (t, p) => (await db.query(t, p)).rows, close: () => db.close() };
  }
  for (const s of SCHEMA_STATEMENTS) await q.query(s);
  await q.query('CREATE TABLE IF NOT EXISTS rc_schema_migrations (id text PRIMARY KEY, description text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const m of MIGRATIONS.filter((x) => x.id < '2026-11-03')) {
    for (const s of m.statements) await q.query(s);
    await q.query('INSERT INTO rc_schema_migrations (id, description) VALUES ($1, $2)', [m.id, m.description]);
  }
  await q.query(`INSERT INTO rc_audit (id, at, data) VALUES ('legacy-audit', now(), '{"action":"legacy"}')`);
  await q.query(`INSERT INTO rc_studies (id, created_at, status, data) VALUES ('legacy-study', now(), 'completed', '{"id":"legacy-study"}')`);
  await q.query(`INSERT INTO rc_study_sessions (study_id, condition_id, replicate, seed, order_key, status) VALUES ('legacy-study', 'A', 0, 1, 1, 'completed'), ('legacy-study', 'A', 1, 2, 2, 'running')`);
  await q.query(`INSERT INTO rc_decisions (study_id, condition_id, replicate, step, data) VALUES ('legacy-study', 'A', 0, 0, '{}'), ('legacy-study', 'A', 1, 0, '{}')`);
  return q;
}

beforeAll(async () => {
  await setupEnv();
  const q = await legacyDb();
  await q.close();
});
afterAll(async () => {
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'session' as const };

describe('データベースの移行', () => {
  it('既存のデータを保ったまま追加のマイグレーションを適用し、既定の組織・プロジェクトに属させる', async () => {
    const { getDb } = await import('@/lib/server/db');
    const db = await getDb();
    const applied = (await db.query<{ id: string }>('SELECT id FROM rc_schema_migrations ORDER BY id')).map((r) => r.id);
    expect(applied).toContain('2026-11-03-001-production-foundation');
    const study = await db.query<{ project_id: string; status: string }>(`SELECT project_id, status FROM rc_studies WHERE id = 'legacy-study'`);
    expect(study[0]).toEqual({ project_id: 'default', status: 'completed' });
    expect((await db.query(`SELECT 1 FROM rc_audit WHERE id = 'legacy-audit'`)).length).toBe(1);
    const org = await db.query<{ mode: string }>(`SELECT mode FROM rc_organizations WHERE id = 'default'`);
    expect(org[0].mode).toBe('personal');
    // 再起動（2回目の接続）では適用済みのマイグレーションを再実行しない
    const { resetDbForTests } = await import('@/lib/server/db');
    await resetDbForTests();
    const again = await getDb();
    expect((await again.query('SELECT 1 FROM rc_schema_migrations')).length).toBe(applied.length);
  });

  it('状態の整合性制約: 定義にない状態は書き込めない', async () => {
    const { getDb } = await import('@/lib/server/db');
    const db = await getDb();
    await expect(db.query(`INSERT INTO rc_studies (id, created_at, status, data) VALUES ('bad', now(), 'exploded', '{}')`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO rc_studies (id, created_at, status, data, project_id) VALUES ('bad2', now(), 'draft', '{}', 'no-such-project')`)).rejects.toThrow();
  });
});

describe('履歴の保護', () => {
  it('監査ログはハッシュの連鎖で記録し、更新・削除はデータベースが拒否する', async () => {
    const { insertAudit, verifyAuditChain } = await import('@/lib/server/storage/store');
    const { getDb } = await import('@/lib/server/db');
    for (let i = 0; i < 5; i++) await insertAudit({ id: `a${i}`, at: new Date().toISOString(), actor: 'test', action: `act.${i}` } as never);
    const v = await verifyAuditChain();
    expect(v).toEqual({ ok: true, checked: 5, brokenAt: null });
    const db = await getDb();
    await expect(db.query(`UPDATE rc_audit SET data = '{"action":"forged"}' WHERE id = 'a2'`)).rejects.toThrow(/変更・削除できません/);
    await expect(db.query(`DELETE FROM rc_audit WHERE id = 'a1'`)).rejects.toThrow(/変更・削除できません/);
    // 既存の（連鎖の導入前の）行も保護される
    await expect(db.query(`DELETE FROM rc_audit WHERE id = 'legacy-audit'`)).rejects.toThrow();
  });

  it('保護を外して書き換えても、連鎖の検証で改ざんを検出する', async () => {
    const { verifyAuditChain } = await import('@/lib/server/storage/store');
    const { getDb } = await import('@/lib/server/db');
    const db = await getDb();
    await db.query('ALTER TABLE rc_audit DISABLE TRIGGER rc_audit_immutable');
    await db.query(`UPDATE rc_audit SET data = '{"action":"forged"}' WHERE id = 'a2'`);
    await db.query('ALTER TABLE rc_audit ENABLE TRIGGER rc_audit_immutable');
    const v = await verifyAuditChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(3);
  });

  it('研究の判断の記録は変更できず、完了したセッションの記録は削除できない（途中のセッションはやり直せる）', async () => {
    const { getDb } = await import('@/lib/server/db');
    const db = await getDb();
    await expect(db.query(`UPDATE rc_decisions SET data = '{"x":1}' WHERE study_id = 'legacy-study'`)).rejects.toThrow(/変更できません/);
    await expect(db.query(`DELETE FROM rc_decisions WHERE study_id = 'legacy-study' AND replicate = 0`)).rejects.toThrow(/削除できません/);
    await db.query(`DELETE FROM rc_decisions WHERE study_id = 'legacy-study' AND replicate = 1`);
    expect((await db.query(`SELECT 1 FROM rc_decisions WHERE study_id = 'legacy-study'`)).length).toBe(1);
  });
});

describe('ジョブキュー', () => {
  it('冪等キーで重複を防ぎ、排他的に取得し、失敗は待ち時間をおいて再試行し、上限で failed にする', async () => {
    const q = await import('@/lib/server/jobs/queue');
    const a = await q.enqueueJob({ kind: 'test.flaky', idempotencyKey: 'k1', maxAttempts: 2, payload: { n: 1 } });
    const b = await q.enqueueJob({ kind: 'test.flaky', idempotencyKey: 'k1', maxAttempts: 2 });
    expect(b.id).toBe(a.id);
    // 2つのワーカーが同時に取得しても、片方だけが得る
    const [w1, w2] = await Promise.all([q.claimJobs('w1', 5, 60_000, ['test.flaky']), q.claimJobs('w2', 5, 60_000, ['test.flaky'])]);
    expect(w1.length + w2.length).toBe(1);
    const owner = w1.length ? 'w1' : 'w2';
    // 担当でないワーカーは結果を記録できない
    expect(await q.completeJob(a.id, owner === 'w1' ? 'w2' : 'w1', 'x')).toBe(false);
    expect(await q.failJob(a.id, owner, new Error('一時的な失敗 sk-abcdefghijklmnopqrstuvwxyz123456'))).toBe('queued');
    // すぐには再取得されない（待ち時間）
    expect(await q.claimJobs('w3', 5, 60_000, ['test.flaky'])).toHaveLength(0);
    const { getDb } = await import('@/lib/server/db');
    const db = await getDb();
    const row = (await db.query<{ last_error: string }>('SELECT last_error FROM rc_jobs WHERE id = $1', [a.id]))[0];
    expect(row.last_error).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    await db.query(`UPDATE rc_jobs SET run_after = now() WHERE id = $1`, [a.id]);
    const again = await q.claimJobs('w3', 5, 60_000, ['test.flaky']);
    expect(again[0].attempts).toBe(2);
    expect(await q.failJob(a.id, 'w3', new Error('再び失敗'))).toBe('failed');
    expect(await q.retryJob(a.id)).toBe(true);
    expect(await q.cancelJob(a.id)).toBe(true);
    const listed = await q.listJobs({ status: 'cancelled' });
    expect(listed.jobs.map((j) => j.id)).toContain(a.id);
  });

  it('リースが切れたジョブ（ワーカーの停止）は別のワーカーが取り直し、処理を完了する', async () => {
    const q = await import('@/lib/server/jobs/queue');
    const job = await q.enqueueJob({ kind: 'test.ok', idempotencyKey: 'k2' });
    const [claimed] = await q.claimJobs('crashed', 1, 1, ['test.ok']);
    expect(claimed.id).toBe(job.id);
    await new Promise((r) => setTimeout(r, 20));
    let ran = 0;
    q.registerJobHandler('test.ok', async () => {
      ran++;
      return { done: true };
    });
    expect(await q.runJobs(Date.now() + 5_000)).toBeGreaterThanOrEqual(1);
    expect(ran).toBe(1);
    const { getDb } = await import('@/lib/server/db');
    const db = await getDb();
    const r = (await db.query<{ status: string; result: unknown }>('SELECT status, result FROM rc_jobs WHERE id = $1', [job.id]))[0];
    expect(r).toEqual({ status: 'succeeded', result: { done: true } });
    const counts = await q.jobCounts();
    expect(counts.succeeded).toBeGreaterThanOrEqual(1);
  });

  it('研究の完了後に Failure の自動検出ジョブを登録して実行する', async () => {
    const { createStudy, startStudy, waitForStudy } = await import('@/lib/server/research/study/studies');
    const { registerJobHandlers } = await import('@/lib/server/jobs/handlers');
    const { runJobs, listJobs } = await import('@/lib/server/jobs/queue');
    const s = await createStudy({ title: 'jobs', conditions: [{ id: 'A', label: 'A' }], replicates: 1, market: { steps: 3 }, agent: { kind: 'mock' } }, actor);
    await startStudy(s.id, actor);
    await waitForStudy(s.id);
    registerJobHandlers();
    await runJobs(Date.now() + 10_000);
    const job = (await listJobs({ limit: 200 })).jobs.find((j) => j.idempotencyKey === `detect_failures:${s.id}`);
    expect(job?.status).toBe('succeeded');
  });
});

describe('構造化ログ', () => {
  it('秘密情報を含みうる項目と、APIキーの形式の文字列を出力しない', async () => {
    const { sanitizeFields } = await import('@/lib/server/log');
    const out = JSON.stringify(sanitizeFields({ apiKey: 'sk-live-abc', password: 'p', nested: { authorization: 'Bearer x', msg: 'key sk-abcdefghijklmnopqrstuvwxyz123456 used' }, jobId: 'j1' }));
    expect(out).not.toMatch(/sk-live-abc|Bearer x|sk-abcdefghijklmnopqrstuvwxyz123456/);
    expect(out).toContain('j1');
  });
});

describe('ヘルスチェック・運用状況', () => {
  it('ヘルスチェックは認証なしで使え、構成の詳細を返さない。運用状況は認証が必要', async () => {
    const { proxy } = await import('@/proxy');
    const { NextRequest } = await import('next/server');
    expect(proxy(new NextRequest('http://localhost/api/health', { headers: { 'x-forwarded-for': '192.0.2.90' } })).status).toBe(200);
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', database: 'ok' });
    expect(proxy(new NextRequest('http://localhost/api/research/ops', { headers: { 'x-forwarded-for': '192.0.2.91' } })).status).toBe(401);
    const { operationsStatus } = await import('@/lib/server/ops');
    const ops = await operationsStatus();
    expect(ops.database.pendingMigrations).toEqual([]);
    expect(ops.audit.ok).toBe(false); // 前のテストで改ざんを再現したため
    const text = JSON.stringify(ops);
    expect(text).not.toMatch(/postgres(ql)?:\/\/|\bsk-[A-Za-z0-9]{8,}/);
  });
});
