import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// 実験比較: ロジスティック回帰（主効果・交互作用・クラスター頑健SE）、2×2 計画、再現性マニフェスト。

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'basic' as const };

beforeAll(async () => {
  await setupEnv();
});
afterAll(async () => {
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

describe('ロジスティック回帰', () => {
  it('逆行列と、既知の係数を持つ模擬データからの推定', async () => {
    const { invert, fitLogistic } = await import('@/lib/server/research/study/regression');
    const { mulberry32 } = await import('@/lib/server/research/sim/market');
    const inv = invert([
      [4, 7],
      [2, 6],
    ])!;
    expect(inv[0][0]).toBeCloseTo(0.6, 10);
    expect(inv[1][0]).toBeCloseTo(-0.2, 10);
    expect(invert([
      [1, 2],
      [2, 4],
    ])).toBeNull();
    // logit p = -1 + 1.2 x1 + 0.5 x2 - 0.8 x1x2
    const rand = mulberry32(42);
    const X: number[][] = [];
    const y: number[] = [];
    const cl: string[] = [];
    for (let i = 0; i < 40_000; i++) {
      const x1 = i % 2;
      const x2 = Math.floor(i / 2) % 2;
      const eta = -1 + 1.2 * x1 + 0.5 * x2 - 0.8 * x1 * x2;
      X.push([1, x1, x2, x1 * x2]);
      y.push(rand() < 1 / (1 + Math.exp(-eta)) ? 1 : 0);
      cl.push(String(Math.floor(i / 20)));
    }
    const fit = fitLogistic(X, y, cl);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const truth = [-1, 1.2, 0.5, -0.8];
    fit.beta.forEach((b, j) => expect(Math.abs(b - truth[j])).toBeLessThan(4 * fit.se[j] + 0.02));
    expect(fit.clusters).toBe(2000);
    // 完全分離（片方の群で常に 1）は推定できないことを報告する
    const sep = fitLogistic(
      [
        [1, 0],
        [1, 0],
        [1, 1],
        [1, 1],
      ],
      [0, 1, 1, 1],
      ['a', 'b', 'c', 'd'],
    );
    expect(sep.ok).toBe(false);
  });

  it('2×2 計画（文言 × 趣旨）＋規則なし統制群: 主効果と交互作用を推定し、統制群は回帰から除く', async () => {
    const { createPairFromTemplate } = await import('@/lib/server/research/study/rules');
    const { createStudy, startStudy, waitForStudy, getStudyDetail } = await import('@/lib/server/research/study/studies');
    const { listDecisions } = await import('@/lib/server/storage/studyStore');
    const { conditionLogistic } = await import('@/lib/server/research/study/regression');
    const { manifestJson, markdownReport } = await import('@/lib/server/research/study/exports');
    const { computeStudyStats } = await import('@/lib/server/research/study/stats');
    const { ruleA, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
    const cell = (id: string, rule: string | null, purpose: boolean) => ({ id, label: id, ruleVersionIds: rule ? [rule] : [], includePurpose: purpose, presentRules: rule !== null });
    const study = await createStudy(
      {
        title: '2x2',
        conditions: [cell('A-C1', ruleA.id, false), cell('A-C2', ruleA.id, true), cell('B-C1', ruleB.id, false), cell('B-C2', ruleB.id, true), cell('C4', null, false)],
        primaryComparison: { treatment: 'B-C1', control: 'A-C1' },
        replicates: 12,
        market: { steps: 15 },
      },
      actor,
    );
    await startStudy(study.id, actor);
    await waitForStudy(study.id);
    const detail = (await getStudyDetail(study.id))!;
    const decisions = await listDecisions(study.id);
    const completed = new Set(detail.sessions.map((s) => `${s.conditionId}/${s.replicate}`));
    const reg = conditionLogistic(detail.study, decisions, completed);
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    expect(reg.terms.map((t) => t.name)).toEqual(['rules', 'includePurpose', 'rules:includePurpose']);
    expect(reg.notes.join()).toContain('C4');
    expect(reg.notes[0]).toContain('モックデータ');
    // モックの行動は趣旨の提示に依存しないため、趣旨の主効果はちょうど 0（同じシードで同じ行動・同じ規則）
    const purpose = reg.coefficients.find((c) => c.term === 'includePurpose')!;
    expect(Math.abs(purpose.estimate)).toBeLessThan(1e-6);
    // 「又は」は「かつ」より違反が多い（規則エンジンの判定の差）
    expect(reg.coefficients.find((c) => c.term === 'rules')!.estimate).toBeGreaterThan(0);
    const stats = computeStudyStats(detail.study, detail.sessions, decisions);
    expect(stats.conditions[0].stepViolationRate).toHaveLength(15);
    expect(stats.conditions.find((c) => c.conditionId === 'C4')!.ruleViolationRate.k).toBe(0);
    const report = markdownReport(detail.study, detail.sessions, stats, reg);
    expect(report).toContain('ロジスティック回帰');
    const manifest = manifestJson(detail.study, detail.sessions, []);
    expect(manifest).toMatchObject({ frozenHash: detail.study.frozenHash, gitCommitSha: 'local', reproducibility: 'deterministic', simulatorVersion: 'exogenous_simple@1' });
    expect(manifest.rules).toHaveLength(2);
    expect(manifest.dataset.completedSessions).toBe(60);
    expect(manifest.limitations.length).toBeGreaterThan(0);
  });
});
