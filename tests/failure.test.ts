import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// Failure-to-Test パイプラインと原因分析: 検出・重複排除・分類・テストケース化・人の承認・仮説・統制実験・状態遷移。

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'basic' as const };

beforeAll(async () => {
  await setupEnv();
});
afterAll(async () => {
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

async function runStudy(conditions: Record<string, unknown>[], replicates = 6, steps = 15) {
  const { createStudy, startStudy, waitForStudy } = await import('@/lib/server/research/study/studies');
  const s = await createStudy({ title: 'failure', conditions, replicates, market: { steps } }, actor);
  await startStudy(s.id, actor);
  await waitForStudy(s.id);
  return s.id;
}

describe('Failure Library', () => {
  it('検出・重複排除・分類・テストケース化・人の承認', async () => {
    const { createPairFromTemplate } = await import('@/lib/server/research/study/rules');
    const { detectFailures, getFailureLibrary, generateTestCases, generateNormalCases, reviewTestCase, reviewFailure } = await import('@/lib/server/research/failure/failures');
    const { listFailures, listTestCases } = await import('@/lib/server/storage/failureStore');
    const { listDecisions } = await import('@/lib/server/storage/studyStore');
    const { ruleA, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
    const studyId = await runStudy([
      { id: 'A', label: 'A', ruleVersionIds: [ruleA.id] },
      { id: 'B', label: 'B', ruleVersionIds: [ruleB.id] },
    ]);
    const first = await detectFailures(studyId, actor);
    expect(first.added).toBeGreaterThan(0);
    expect(first.added).toBe(first.detected);
    // 再実行しても重複しない
    expect((await detectFailures(studyId, actor)).added).toBe(0);
    const failures = await listFailures({ studyId });
    const decisions = await listDecisions(studyId);
    const violations = decisions.filter((d) => d.enforcement.violations.some((v) => v.ruleKey)).length;
    expect(failures.filter((f) => f.category === 'formal_violation')).toHaveLength(violations);
    for (const f of failures) {
      expect(f.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(f.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(f.isMock).toBe(true);
    }
    const lib = await getFailureLibrary();
    expect(lib.total).toBe(failures.length);
    expect(lib.clusters.reduce((a, c) => a + c.count, 0)).toBe(failures.length);
    expect(lib.clusters.length).toBeLessThan(failures.length);
    // 重大度の順（high が先）
    const order = ['low', 'medium', 'high'];
    for (let i = 1; i < lib.clusters.length; i++) expect(order.indexOf(lib.clusters[i - 1].severity)).toBeGreaterThanOrEqual(order.indexOf(lib.clusters[i].severity));

    const cluster = lib.clusters.find((c) => c.category === 'formal_violation')!;
    const tc = await generateTestCases(cluster.fingerprint, actor, 2);
    expect(tc.created).toBe(Math.min(2, cluster.count));
    expect((await generateTestCases(cluster.fingerprint, actor, 2)).created).toBe(0);
    const cases = await listTestCases({ fingerprint: cluster.fingerprint });
    expect(cases.every((c) => c.status === 'candidate' && c.expectedIntent === null && c.expectedFormal.ruleViolation)).toBe(true);
    // 期待する趣旨の判定がないと承認できない
    await expect(reviewTestCase(cases[0].id, { status: 'approved' }, actor)).rejects.toThrow(/期待する趣旨/);
    const approved = await reviewTestCase(cases[0].id, { status: 'approved', expectedIntent: 'deviation_suspected', reviewNote: '確認済み' }, actor);
    expect(approved).toMatchObject({ status: 'approved', reviewedBy: '研究チーム' });
    const normal = await generateNormalCases(studyId, 5, actor);
    expect(normal.created).toBe(5);
    expect((await listTestCases({ dataset: 'normal_behavior' })).every((t) => t.expectedFormal.verdict === 'ACCEPT')).toBe(true);
    const dismissed = await reviewFailure(failures[0].id, { status: 'dismissed', reviewNote: '誤検出' }, actor);
    expect(dismissed.status).toBe('dismissed');
  });
});

describe('原因分析', () => {
  it('仮説の生成 → 統制実験 → 結果による状態の更新。トレースだけでは「効果を支持」にならない', async () => {
    const { createPairFromTemplate } = await import('@/lib/server/research/study/rules');
    const { detectFailures, getFailureLibrary } = await import('@/lib/server/research/failure/failures');
    const { generateHypotheses, scheduleExperiment, evaluateHypothesis, evidenceGraph } = await import('@/lib/server/research/failure/rootCause');
    const { waitForStudy, getStudyDetail } = await import('@/lib/server/research/study/studies');
    const { pair, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
    expect(pair).toBeTruthy();
    // 「又は」の規則・趣旨なし・利益最大化の条件
    const studyId = await runStudy([{ id: 'B', label: 'B', ruleVersionIds: [ruleB.id], objective: 'profit_max' }], 8);
    await detectFailures(studyId, actor);
    const cluster = (await getFailureLibrary()).clusters.find((c) => c.category === 'formal_violation' && c.ruleKeys.includes('SPOOF-OR'))!;
    const hs = await generateHypotheses(cluster.fingerprint, actor);
    const factors = hs.map((h) => h.factor).sort();
    expect(factors).toEqual(['conjunction', 'objective_incentive', 'purpose_not_presented'].sort());
    expect(hs.every((h) => h.status === 'SUPPORTED_BY_TRACE')).toBe(true);
    // 同じ仮説は重複して作らない
    expect(await generateHypotheses(cluster.fingerprint, actor)).toHaveLength(0);

    // 接続詞: ミニマルペアの相手（かつ）に替える統制実験
    const conj = hs.find((h) => h.factor === 'conjunction')!;
    expect(conj.intervention.kind).toBe('swap_rule');
    await expect(evaluateHypothesis(conj.id, actor)).rejects.toThrow(/検証実験が作成されていません/);
    const scheduled = await scheduleExperiment(conj.id, { replicates: 10, start: true }, actor);
    expect(scheduled.status).toBe('EXPERIMENT_SCHEDULED');
    const exp = (await getStudyDetail(scheduled.experimentStudyId!))!;
    expect(exp.study.design.conditions.map((c) => c.id)).toEqual(['C', 'T']);
    expect(exp.study.design.baseSeed).toBeDefined();
    await waitForStudy(scheduled.experimentStudyId!);
    const evaluated = await evaluateHypothesis(conj.id, actor);
    // 「かつ」は「又は」より狭いため、同じ行動でも違反は減る（判定基準の変化を含むことを注意として記録）
    expect(evaluated.status).toBe('EVIDENCE_SUPPORTS_EFFECT');
    expect(evaluated.effect!.diff!).toBeLessThan(0);
    expect(evaluated.effect!.caveats.join()).toContain('判定基準の変化');
    expect(evaluated.effect!.caveats.join()).toContain('モックデータ');
    expect(evaluated.history.map((x) => x.status)).toEqual(['HYPOTHESIS', 'SUPPORTED_BY_TRACE', 'EXPERIMENT_SCHEDULED', 'EXPERIMENT_TESTED', 'EVIDENCE_SUPPORTS_EFFECT']);

    // 趣旨の提示: モックは趣旨を読まないため効果は 0 → 判断保留
    const purpose = hs.find((h) => h.factor === 'purpose_not_presented')!;
    const p2 = await scheduleExperiment(purpose.id, { replicates: 6, start: true }, actor);
    await waitForStudy(p2.experimentStudyId!);
    const ev2 = await evaluateHypothesis(purpose.id, actor);
    expect(ev2.status).toBe('EVIDENCE_INCONCLUSIVE');
    expect(ev2.effect!.diff).toBe(0);

    const graph = await evidenceGraph(conj.id);
    const kinds = new Set(graph.nodes.map((n) => n.kind));
    for (const k of ['rule', 'document', 'decision', 'action', 'failure', 'hypothesis', 'experiment', 'effect']) expect(kinds.has(k as never)).toBe(true);
    expect(graph.edges.find((e) => e.from.startsWith('hypothesis:'))!.verified).toBe(true);
    const unverified = await evidenceGraph(hs.find((h) => h.factor === 'objective_incentive')!.id);
    expect(unverified.edges.find((e) => e.from.startsWith('hypothesis:'))).toMatchObject({ verified: false, label: '原因の候補（未検証）' });
  });
});
