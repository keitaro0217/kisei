import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// Auto-Patch と回帰テスト: 修正案の生成・承認の流れ・実験用の規則の分離・決定論的な回帰テスト・ゲート・副作用・パレート最適。

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'basic' as const };

beforeAll(async () => {
  await setupEnv();
});
afterAll(async () => {
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

describe('ゲートとパレート最適', () => {
  it('件数が少なく区間が広い場合は PASS にしない', async () => {
    const { decideGate, DEFAULT_THRESHOLDS, paretoFrontier } = await import('@/lib/server/research/patch/regression');
    const { wilson } = await import('@/lib/server/research/study/stats');
    const m = (prevK: number, prevN: number, frK: number, frN: number) => ({
      prevention: { before: wilson(0, prevN), after: wilson(prevK, prevN) },
      falseRejection: { before: wilson(0, frN), after: wilson(frK, frN) },
      previouslyFixed: { after: wilson(0, 0) },
      newFailures: 0,
      notApplicable: 0,
      riskReduction: null,
      falseRejectionIncrease: null,
    });
    const opts = (r: number, a: number) => ({ needsReview: false, addedCost: null, counts: { reject: r, accept: a } });
    expect(decideGate(m(5, 5, 0, 5), DEFAULT_THRESHOLDS, opts(5, 5)).gate).toBe('INCONCLUSIVE');
    expect(decideGate(m(200, 200, 2, 200), DEFAULT_THRESHOLDS, opts(200, 200)).gate).toBe('PASS');
    expect(decideGate(m(200, 200, 2, 200), DEFAULT_THRESHOLDS, { ...opts(200, 200), needsReview: true }).gate).toBe('REVIEW_REQUIRED');
    expect(decideGate(m(100, 200, 2, 200), DEFAULT_THRESHOLDS, opts(200, 200)).gate).toBe('FAIL');
    expect(decideGate(m(200, 200, 60, 200), DEFAULT_THRESHOLDS, opts(200, 200)).gate).toBe('FAIL');
    expect(decideGate(m(200, 200, 2, 200), { ...DEFAULT_THRESHOLDS, maxAddedCostUsd: 0.01 }, { ...opts(200, 200), addedCost: 0.5 }).gate).toBe('FAIL');
    expect(decideGate(m(3, 3, 0, 3), DEFAULT_THRESHOLDS, opts(3, 3)).reasons.join()).toContain('最小件数');
    const f = paretoFrontier([
      { id: 'a', risk: 0.5, falseRejection: 0.1 },
      { id: 'b', risk: 0.3, falseRejection: 0.0 },
      { id: 'c', risk: 0.2, falseRejection: 0.2 },
      { id: 'd', risk: 0.5, falseRejection: 0.1 },
    ]);
    expect([...f].sort()).toEqual(['a', 'b', 'd']);
  });
});

describe('Auto-Patch と回帰テスト', () => {
  it('修正案を生成し、承認の流れ・実験用の規則・回帰テスト・再実験を経ても元の規則は変わらない', async () => {
    const { createPairFromTemplate, listRules } = await import('@/lib/server/research/study/rules');
    const { createStudy, startStudy, waitForStudy } = await import('@/lib/server/research/study/studies');
    const { detectFailures, getFailureLibrary, generateTestCases, generateNormalCases, reviewTestCase } = await import('@/lib/server/research/failure/failures');
    const { listTestCases } = await import('@/lib/server/storage/failureStore');
    const { generatePatches, transitionPatch, startPatchExperiment } = await import('@/lib/server/research/patch/patches');
    const { runRegression, patchOverview } = await import('@/lib/server/research/patch/regression');

    const { ruleA } = await createPairFromTemplate('spoof_and_or', actor);
    const s = await createStudy({ title: 'patch-src', conditions: [{ id: 'A', label: 'A', ruleVersionIds: [ruleA.id] }], replicates: 10, market: { steps: 20 } }, actor);
    await startStudy(s.id, actor);
    await waitForStudy(s.id);
    await detectFailures(s.id, actor);
    const intentClusters = (await getFailureLibrary()).clusters.filter((c) => c.category === 'intent_deviation' && c.codes.includes('INTENT_FREQUENT_CANCEL'));
    expect(intentClusters.length).toBeGreaterThan(0);
    const cluster = intentClusters[0];

    // テストケース: 既知の Failure（趣旨逸脱）を承認し、正常な行動のケースも承認する
    for (const c of intentClusters) await generateTestCases(c.fingerprint, actor, 6);
    await generateNormalCases(s.id, 12, actor);
    for (const t of await listTestCases()) {
      await reviewTestCase(t.id, { status: 'approved', expectedIntent: t.dataset === 'normal_behavior' ? 'aligned' : 'deviation_suspected' }, actor);
    }

    const patches = await generatePatches({ fingerprint: cluster.fingerprint }, actor);
    const cats = patches.map((p) => p.category).sort();
    expect(cats).toEqual(['definition', 'prompt', 'regulatory_text', 'system_rule', 'system_rule'].sort());
    expect(patches.every((p) => p.status === 'draft' && p.generator === 'kisei-template-v1')).toBe(true);
    // 同じ内容の修正案は重複して作らない
    expect(await generatePatches({ fingerprint: cluster.fingerprint }, actor)).toHaveLength(0);

    const promote = patches.find((p) => p.title.includes('趣旨逸脱の基準'))!;
    await expect(transitionPatch(promote.id, { to: 'approved_for_simulation' }, actor)).rejects.toThrow(/変更できません/);
    await expect(runRegression(promote.id, {}, actor)).rejects.toThrow(/承認された/);
    await transitionPatch(promote.id, { to: 'under_review' }, actor);
    const approved = await transitionPatch(promote.id, { to: 'approved_for_simulation', note: '実験してよい' }, actor);
    expect(approved.sandboxRuleId).toBeTruthy();
    const rules = await listRules();
    const sandbox = rules.find((r) => r.id === approved.sandboxRuleId)!;
    expect(sandbox.ruleKey).toBe('SPOOF-AND-PATCH');
    // 元の規則の最新版は変わらない（本番の規則へ反映しない）
    const originals = rules.filter((r) => r.ruleKey === 'SPOOF-AND');
    expect(Math.max(...originals.map((r) => r.version))).toBe(ruleA.version);
    expect(originals.find((r) => r.id === ruleA.id)!.checks).toHaveLength(1);

    // 回帰テスト: 趣旨逸脱のケースは修正後に防げ、正常なケースは受理されたまま
    const run = await runRegression(promote.id, {}, actor);
    expect(run.metrics.prevention.before.p).toBe(0);
    expect(run.metrics.prevention.after.p).toBe(1);
    expect(run.metrics.falseRejection.after.p).toBe(0);
    expect(run.metrics.riskReduction).toBe(1);
    expect(run.metrics.newFailures).toBe(0);
    // 防ぐべきケースが少ないため、点推定が良くても区間が広く PASS にしない
    expect(run.gate).toBe('INCONCLUSIVE');
    const relaxed = await runRegression(promote.id, { thresholds: { minPreventionRate: 0.3, maxFalseRejectionRate: 0.4, minCasesPerDataset: 2 } }, actor);
    expect(relaxed.gate).toBe('PASS');

    // 閾値を厳しくする修正案は、正常な行動を拒否する副作用が出うる（決定論的に再現）
    const tighten = patches.find((p) => p.title.includes('閾値'))!;
    expect(tighten.after!.parameters.largeQty).toBe(450);
    await transitionPatch(tighten.id, { to: 'under_review' }, actor);
    await transitionPatch(tighten.id, { to: 'approved_for_simulation' }, actor);
    const tRun = await runRegression(tighten.id, {}, actor);
    expect(tRun.outcomes.length).toBe(relaxed.outcomes.length);

    // 再実験（同じ市場・同じシード）
    const withExp = await startPatchExperiment(promote.id, { replicates: 6, start: true }, actor);
    await waitForStudy(withExp.experimentStudyId!);
    const afterExp = await runRegression(promote.id, { thresholds: { minPreventionRate: 0.3, maxFalseRejectionRate: 0.4, minCasesPerDataset: 2 } }, actor);
    expect(afterExp.experiment).not.toBeNull();
    expect(afterExp.experiment!.isMock).toBe(true);
    expect(afterExp.experiment!.violationRate.treatment!).toBeGreaterThanOrEqual(afterExp.experiment!.violationRate.control!);

    // 提案としての承認: FAIL では不可、PASS 以外は理由が必要
    await transitionPatch(promote.id, { to: 'simulation_completed' }, actor);
    const rec = await transitionPatch(promote.id, { to: 'approved_for_recommendation', note: 'OK' }, actor);
    expect(rec.status).toBe('approved_for_recommendation');
    expect(rec.reviews.map((r) => r.to)).toEqual(['under_review', 'approved_for_simulation', 'simulation_completed', 'approved_for_recommendation']);
    await expect(transitionPatch(tighten.id, { to: 'rejected' }, actor)).rejects.toThrow(/理由/);

    const overview = await patchOverview();
    expect(overview.find((o) => o.patch.id === promote.id)!.pareto).toBe(true);
  });
});
