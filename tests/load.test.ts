import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// 負荷試験（通常のテストでは実行しない）: LOAD_TEST=1 npm test -- tests/load.test.ts
// 大規模な研究（既定: 8条件 × 250反復 × 50ステップ = 100,000 判断）を、複数のワーカーが同時に処理しても
// 重複・欠落なく完了し、集計・Failure の検出・一覧の取得が実用的な時間で終わることを確かめる。
// 外部の API は使わない（モックのエージェント）。

const enabled = process.env.LOAD_TEST === '1';
const REPLICATES = Number(process.env.LOAD_REPLICATES || 250);
const STEPS = Number(process.env.LOAD_STEPS || 50);
const WORKERS = Number(process.env.LOAD_WORKERS || 4);
const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'session' as const };

beforeAll(async () => {
  if (enabled) await setupEnv();
});
afterAll(async () => {
  if (!enabled) return;
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

describe.skipIf(!enabled)('負荷試験', () => {
  it(
    '大規模な研究を複数のワーカーで同時に処理し、重複・欠落なく完了する',
    async () => {
      const { createPairFromTemplate } = await import('@/lib/server/research/study/rules');
      const { createStudy, startStudy, runStudySlice, getStudyDetail } = await import('@/lib/server/research/study/studies');
      const { detectFailures } = await import('@/lib/server/research/failure/failures');
      const { computeStudyStats } = await import('@/lib/server/research/study/stats');
      const { listDecisions } = await import('@/lib/server/storage/studyStore');
      const { getDb } = await import('@/lib/server/db');
      const { ruleA, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
      const conditions = Array.from({ length: 8 }, (_, i) => ({ id: `C${i}`, label: `条件${i}`, ruleVersionIds: [i % 2 ? ruleA.id : ruleB.id], presentRules: i % 4 < 2 }));
      const s = await createStudy({ title: 'load', conditions, replicates: REPLICATES, market: { steps: STEPS }, agent: { kind: 'mock' } }, actor);
      await startStudy(s.id, actor);
      const t0 = Date.now();
      // 複数のワーカー（別々の関数実行に相当）が同時にスライスを処理する
      for (let round = 0; round < 1000; round++) {
        const results = await Promise.all(Array.from({ length: WORKERS }, () => runStudySlice(s.id, Date.now() + 20_000)));
        if (results.every((r) => r === 'done')) {
          const st = (await getStudyDetail(s.id))!.study.status;
          if (st !== 'running') break;
        }
      }
      const runMs = Date.now() - t0;
      const detail = (await getStudyDetail(s.id))!;
      expect(detail.study.status).toBe('completed');
      const db = await getDb();
      const expected = conditions.length * REPLICATES * STEPS;
      const [{ n, uniq }] = await db.query<{ n: number; uniq: number }>(
        `SELECT count(*)::int AS n, count(DISTINCT (condition_id, replicate, step))::int AS uniq FROM rc_decisions WHERE study_id = $1`,
        [s.id],
      );
      expect(n).toBe(expected);
      expect(uniq).toBe(expected);
      expect(detail.sessions.every((x) => x.status === 'completed')).toBe(true);
      const attempts = detail.sessions.reduce((a, x) => a + x.attempts, 0);

      const t1 = Date.now();
      const decisions = await listDecisions(s.id);
      const stats = computeStudyStats(detail.study, detail.sessions, decisions);
      const statsMs = Date.now() - t1;
      const t2 = Date.now();
      const det = await detectFailures(s.id, actor);
      const detectMs = Date.now() - t2;
      const t3 = Date.now();
      const page = await db.query(`SELECT data FROM rc_failures WHERE study_id = $1 ORDER BY created_at DESC LIMIT 50`, [s.id]);
      const pageMs = Date.now() - t3;

      console.log(
        JSON.stringify(
          {
            db: db.kind,
            decisions: n,
            sessions: detail.sessions.length,
            workers: WORKERS,
            sessionAttempts: attempts,
            runSeconds: +(runMs / 1000).toFixed(1),
            decisionsPerSecond: Math.round(n / (runMs / 1000)),
            statsSeconds: +(statsMs / 1000).toFixed(2),
            failuresDetected: det.detected,
            detectSeconds: +(detectMs / 1000).toFixed(2),
            failurePageMs: pageMs,
            conditions: stats.conditions.length,
          },
          null,
          1,
        ),
      );
      expect(page.length).toBeGreaterThan(0);
    },
    60 * 60_000,
  );
});
