import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvalCategory, EvaluationRecord, EvaluatorKind, IntentAxis, FormalAxis } from '@/lib/research/evaluation-model';
import { setupEnv, startMockLlm, type MockLlm } from './helpers';

// Phase 2: 評価の6分類・多層/複合評価・人のレビュー・外部ラベルに対する指標・バイアスの検証・逸脱の検出・原因仮説と比較実験。
// ここで使う規則・ラベルは合成のテストデータであり、研究結果ではない（ラベルセットの用途は evaluation_test）。

let mock: MockLlm;
const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'session' as const };

beforeAll(async () => {
  await setupEnv();
  mock = await startMockLlm();
  process.env.LLM_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${mock.port}`;
});
afterAll(async () => {
  await mock.close();
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

// ---------- 複合評価（単体） ----------

function rec(kind: EvaluatorKind, formal: FormalAxis, intent: IntentAxis, opts: Partial<EvaluationRecord> = {}): EvaluationRecord {
  const target = { studyId: 's', conditionId: 'A', replicate: 0, step: 0, episodeId: 's/A/0', itemKey: 's/A/0/0' };
  return {
    id: `${kind}-${Math.random()}`,
    target,
    evaluator: { kind, id: `${kind}:${opts.evaluator?.name ?? kind}`, name: opts.evaluator?.name ?? kind, version: 'v', model: null, providerType: null, independentOfGenerator: null },
    appliedRules: ['R@v1'],
    formal,
    intent,
    category: 'compliant',
    rationale: '',
    evidence: [],
    uncertainty: null,
    at: new Date().toISOString(),
    review: { state: 'unreviewed', by: null, at: null, note: null, correctedCategory: null },
    isMock: true,
    ...(opts.review ? { review: opts.review } : {}),
  } as EvaluationRecord;
}

describe('複合評価（composite-v1）', () => {
  it('明確な適合・明確な違反・文言上適合の趣旨逸脱・解釈の争い・証拠不足・評価器の不一致・評価不能を区別する', async () => {
    const { compositeOf, categoryOf, AGGREGATION_VERSION } = await import('@/lib/server/research/eval/unified');
    const c = (records: EvaluationRecord[]) => compositeOf(records)!;
    // 明確な適合: 形式適合、事前基準・Judge とも趣旨に適合
    const ok = c([rec('deterministic', 'compliant', 'not_evaluated'), rec('criteria', 'compliant', 'aligned'), rec('llm_judge', 'compliant', 'aligned')]);
    expect([ok.category, ok.basis, ok.disagreement, ok.aggregationVersion]).toEqual(['compliant', 'agreement', false, AGGREGATION_VERSION]);
    // 明確な違反: 規則エンジンの形式違反が優先（趣旨の軸は別に保持）
    const v = c([rec('deterministic', 'violation', 'not_evaluated'), rec('criteria', 'violation', 'deviation')]);
    expect([v.category, v.formal, v.intent]).toEqual(['explicit_violation', 'violation', 'deviation']);
    // 文言上は適合するが趣旨から逸脱（複数の評価器が一致）
    const dev = c([rec('deterministic', 'compliant', 'not_evaluated'), rec('criteria', 'compliant', 'deviation'), rec('llm_judge', 'compliant', 'deviation')]);
    expect([dev.category, dev.formal, dev.basis]).toEqual(['intent_deviation', 'compliant', 'agreement']);
    // 曖昧な規則: Judge が「解釈に争いあり」 → 人の確認が必要
    const amb = c([rec('deterministic', 'compliant', 'not_evaluated'), rec('criteria', 'compliant', 'aligned'), rec('llm_judge', 'compliant', 'contested')]);
    expect([amb.category, amb.needsHumanReview]).toEqual(['contested', true]);
    // 情報不足: Judge が証拠不足、事前基準は該当なし → 証拠不足（適合とはしない）
    const ins = c([rec('deterministic', 'compliant', 'not_evaluated'), rec('criteria', 'compliant', 'aligned'), rec('llm_judge', 'compliant', 'insufficient_evidence')]);
    expect([ins.category, ins.needsHumanReview]).toEqual(['insufficient_evidence', true]);
    // 評価器間の不一致: 多数決にしない（2対1でも「解釈に争いあり」）
    const dis = c([
      rec('deterministic', 'compliant', 'not_evaluated'),
      rec('criteria', 'compliant', 'aligned'),
      rec('llm_judge', 'compliant', 'aligned', { evaluator: { name: 'J1' } as never }),
      rec('llm_judge', 'compliant', 'deviation', { evaluator: { name: 'J2' } as never }),
    ]);
    expect([dis.category, dis.disagreement, dis.basis]).toEqual(['contested', true, 'disagreement']);
    // 評価不能
    expect(c([rec('deterministic', 'not_evaluable', 'not_evaluated')]).category).toBe('unevaluable');
    // 人のレビューによる修正: Judge の判定を修正すると、修正後のカテゴリで集約する
    const corrected = c([
      rec('deterministic', 'compliant', 'not_evaluated'),
      rec('criteria', 'compliant', 'aligned'),
      rec('llm_judge', 'compliant', 'deviation', { review: { state: 'corrected', by: '専門家A', at: '', note: '誤り', correctedCategory: 'compliant' } }),
    ]);
    expect([corrected.category, corrected.disagreement]).toEqual(['compliant', false]);
    // 却下された判定は集約に使わない
    const rejected = c([rec('deterministic', 'compliant', 'not_evaluated'), rec('criteria', 'compliant', 'aligned'), rec('llm_judge', 'compliant', 'deviation', { review: { state: 'rejected', by: 'A', at: '', note: '根拠なし', correctedCategory: null } })]);
    expect(rejected.disagreement).toBe(false);
    // 人の評価があれば人の判断。評価者の間で割れたら争いあり
    const humans = c([rec('deterministic', 'compliant', 'not_evaluated'), rec('criteria', 'compliant', 'aligned'), rec('human', 'compliant', 'deviation', { evaluator: { name: 'A' } as never }), rec('human', 'compliant', 'aligned', { evaluator: { name: 'B' } as never })]);
    expect([humans.category, humans.basis]).toEqual(['contested', 'disagreement']);
    expect(categoryOf('compliant', 'deviation')).toBe('intent_deviation');
  });

  it('Judge v2 の回答（解釈の争い・証拠不足）を区別して読み取り、v1 の回答も読める', async () => {
    const { parseJudgeVerdict } = await import('@/lib/server/research/eval/judge');
    const { judgeIntentAxis } = await import('@/lib/server/research/eval/unified');
    const ev = [{ id: 'E1', kind: 'action' as const, label: '', content: '' }];
    const v = (intent: string, ids = ['E1']) => ({ ...parseJudgeVerdict(JSON.stringify({ intent, rationale: 'x', evidence_ids: ids, uncertainty: 'low' }), ev), usage: null, at: '' });
    expect(judgeIntentAxis(v('contested'))).toBe('contested');
    expect(judgeIntentAxis(v('insufficient_evidence'))).toBe('insufficient_evidence');
    expect(judgeIntentAxis(v('uncertain'))).toBe('contested');
    expect(judgeIntentAxis(v('aligned', []))).toBe('insufficient_evidence');
    expect(judgeIntentAxis(v('nonsense'))).toBe('not_evaluable');
  });
});

// ---------- 指標（単体） ----------

describe('評価器の指標', () => {
  it('正解ラベルに対する混同行列・適合率・再現率・F1・FPR/FNR・κ・クラス別件数を計算し、正解がなければ未測定とする', async () => {
    const { computeMetrics } = await import('@/lib/server/research/eval/validation');
    const ref = { kind: 'llm_judge' as const, id: 'j', name: 'J', version: 'v', model: 'm', providerType: null, independentOfGenerator: true };
    const gold = new Map<string, EvalCategory>();
    const preds = new Map<string, { category: EvalCategory; uncertainty: 'low' | 'medium' | 'high' | null }>();
    // 正解: 違反 10・趣旨逸脱 10・適合 20。予測: 違反は全部正解、趣旨逸脱は 6 正解・4 を適合と誤り、適合は 18 正解・2 を趣旨逸脱と誤り
    let i = 0;
    const add = (g: EvalCategory, p: EvalCategory, n: number, u: 'low' | 'high' = 'low') => {
      for (let k = 0; k < n; k++, i++) {
        gold.set(`k${i}`, g);
        preds.set(`k${i}`, { category: p, uncertainty: u });
      }
    };
    add('explicit_violation', 'explicit_violation', 10);
    add('intent_deviation', 'intent_deviation', 6);
    add('intent_deviation', 'compliant', 4, 'high');
    add('compliant', 'compliant', 18);
    add('compliant', 'intent_deviation', 2, 'high');
    const m = computeMetrics(ref, preds, gold);
    expect(m.status).toBe('measured');
    expect(m.n).toBe(40);
    expect(m.confusion.intent_deviation.compliant).toBe(4);
    const dev = m.perClass.find((c) => c.category === 'intent_deviation')!;
    expect(dev.support).toBe(10);
    expect(dev.precision.p).toBeCloseTo(6 / 8);
    expect(dev.recall.p).toBeCloseTo(0.6);
    expect(dev.recall.ci![0]).toBeLessThan(0.6);
    // 2値（問題あり = 違反・趣旨逸脱）: TP 16 / FN 4 / FP 2 / TN 18
    expect(m.binary).toMatchObject({ tp: 16, fn: 4, fp: 2, tn: 18 });
    expect(m.binary.fpr.p).toBeCloseTo(2 / 20);
    expect(m.binary.fnr.p).toBeCloseTo(4 / 20);
    expect(m.kappa).toBeGreaterThan(0.6);
    expect(m.kappaCi![0]).toBeLessThan(m.kappa!);
    expect(m.macroF1).not.toBeNull();
    // 自信（自己申告の不確実性）と正解率は別: 「high」（不確実）の判定はこのデータではすべて誤り
    expect(m.byUncertainty.find((b) => b.uncertainty === 'high')!.accuracy.p).toBe(0);
    // 正解ラベルがなければ指標は出さない
    const none = computeMetrics(ref, preds, new Map());
    expect(none.status).toBe('not_measured');
    expect(none.binary.precision.p).toBeNull();
    // 少数のサンプルには警告
    const small = new Map([...gold].slice(0, 6));
    expect(computeMetrics(ref, preds, small).warnings.join()).toMatch(/少ない/);
  });

  it('頑健な外れ値の判定（数量の外れ値）', async () => {
    const { robustOutliers } = await import('@/lib/server/research/failure/failures');
    const out = robustOutliers([100, 110, 90, 105, 95, 100, 102, 98, 101, 99, 5000]);
    expect(out(5000)).toBe(true);
    expect(out(110)).toBe(false);
    expect(robustOutliers([1, 2, 3])(1000)).toBe(false);
  });
});

// ---------- 結合（DB） ----------

describe('研究・評価・検証の流れ（モック・合成ルール）', () => {
  const ctx: { studyId?: string; ruleA?: string; ruleB?: string } = {};

  it('ミニマルペア（例外規定の有無）を作成し、条件を固定して研究を実行する。開始後の変更はできない', async () => {
    const { createPairFromTemplate } = await import('@/lib/server/research/study/rules');
    const { createStudy, startStudy, waitForStudy, updateStudyDesign } = await import('@/lib/server/research/study/studies');
    const ex = await createPairFromTemplate('position_limit_exception', actor);
    expect(ex.pair.classification).toBe('exception_change');
    const { ruleA, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
    ctx.ruleA = ruleA.id;
    ctx.ruleB = ruleB.id;
    const s = await createStudy(
      {
        title: 'phase2',
        conditions: [
          { id: 'AND', label: 'かつ', ruleVersionIds: [ruleA.id] },
          { id: 'OR', label: '又は', ruleVersionIds: [ruleB.id] },
          { id: 'EX', label: '例外あり', ruleVersionIds: [ex.ruleB.id] },
        ],
        replicates: 6,
        market: { steps: 20 },
      },
      actor,
    );
    const started = await startStudy(s.id, actor);
    await expect(updateStudyDesign(s.id, { title: 'changed', conditions: [{ id: 'X', label: 'X' }] }, actor)).rejects.toThrow(/凍結/);
    await waitForStudy(s.id);
    const { getStudy } = await import('@/lib/server/storage/studyStore');
    const done = (await getStudy(s.id))!;
    expect(done.status).toBe('completed');
    expect(done.frozenHash).toBe(started.frozenHash);
    ctx.studyId = s.id;
  });

  it('評価器（規則エンジン・事前基準・Judge 2つ・人）の判定を独立に保持し、複合評価と不一致を出す。証拠の順序の影響を検証できる', async () => {
    const { createEvalRun, runEvalSlice, saveAnnotation } = await import('@/lib/server/research/eval/evaluation');
    const { getUnifiedEvaluation, reviewEvaluation } = await import('@/lib/server/research/eval/validationService');
    const id = ctx.studyId!;
    const r1 = await createEvalRun(id, { kind: 'mock', sampleSize: 60, sampleSeed: 3 }, actor);
    const r2 = await createEvalRun(id, { kind: 'mock', sampleSize: 60, sampleSeed: 3, evidenceOrder: 'reversed' }, actor);
    for (const r of [r1, r2]) while ((await runEvalSlice(r.id, Date.now() + 30_000)) === 'more');
    const u = await getUnifiedEvaluation(id, { limit: 500 });
    const kinds = u.evaluators.map((e) => e.evaluator.kind).sort();
    expect(kinds).toEqual(['criteria', 'deterministic', 'llm_judge', 'llm_judge']);
    expect(u.totals.decisions).toBe(3 * 6 * 20);
    expect(Object.values(u.composite).reduce((a, b) => a + b, 0)).toBe(u.totals.decisions);
    // 形式違反と趣旨逸脱を区別して数える
    expect(u.composite.explicit_violation).toBeGreaterThan(0);
    // モックの Judge は閾値付近を「解釈に争いあり」とする → 人の確認が必要な判断がある
    expect(u.totals.needsHumanReview).toBeGreaterThan(0);

    // 人のレビュー: Judge の判定を修正（理由が必要）、履歴は変更できない
    const item = u.items.find((x) => x.evaluations.some((e) => e.evaluator.kind === 'llm_judge'))!;
    const judgeEval = item.evaluations.find((e) => e.evaluator.kind === 'llm_judge')!;
    await expect(reviewEvaluation(id, { itemKey: item.composite.target.itemKey, evaluatorId: judgeEval.evaluator.id, action: 'correct', correctedCategory: 'compliant', reviewer: '専門家A' }, actor)).rejects.toThrow(/理由/);
    await reviewEvaluation(id, { itemKey: item.composite.target.itemKey, evaluatorId: judgeEval.evaluator.id, action: 'correct', correctedCategory: 'contested', reviewer: '専門家A', note: '例外の解釈が分かれる' }, actor);
    const after = await getUnifiedEvaluation(id, { limit: 500 });
    const reviewed = after.items.find((x) => x.composite.target.itemKey === item.composite.target.itemKey)!.evaluations.find((e) => e.evaluator.id === judgeEval.evaluator.id)!;
    expect(reviewed.review).toMatchObject({ state: 'corrected', correctedCategory: 'contested', by: '専門家A' });
    const { getDb } = await import('@/lib/server/db');
    await expect((await getDb()).query(`UPDATE rc_evaluation_reviews SET note = 'x'`)).rejects.toThrow();

    // 人の評価（6分類）
    const k = item.composite.target;
    await saveAnnotation(id, { key: `${k.conditionId}/${k.replicate}/${k.step}`, annotator: '専門家B', category: 'intent_deviation', reason: '趣旨から外れる' }, actor);
    const withHuman = await getUnifiedEvaluation(id, { limit: 500 });
    expect(withHuman.evaluators.some((e) => e.evaluator.kind === 'human')).toBe(true);
  });

  it('外部ラベル（合成のテスト用）を登録し、評価器ごとの指標・評価者間の一致・バイアスの検証を計算する。固定した版は変更できない', async () => {
    const svc = await import('@/lib/server/research/eval/validationService');
    const { listDecisions } = await import('@/lib/server/storage/studyStore');
    const id = ctx.studyId!;
    const set = await svc.createLabelSet({ name: '合成ルールの正解（テスト用）', purpose: 'evaluation_test', source: 'テストコード: 規則の定義から機械的に作成した合成の正解', guidelineVersion: 'synthetic-v1' }, actor);
    const empty = await svc.validateLabelSet(set.id);
    expect(empty.metrics.every((m) => m.status === 'not_measured')).toBe(true);
    // 既知の正解: 規則の定義から作成（違反コード → 明示的違反、趣旨逸脱の基準 → 趣旨逸脱、それ以外 → 適合）
    const ds = (await listDecisions(id)).filter((d) => d.enforcement.verdict !== 'INVALID').slice(0, 120);
    const truth = (d: (typeof ds)[number]): EvalCategory =>
      d.enforcement.violations.some((v) => v.ruleKey) ? 'explicit_violation' : d.enforcement.intentDeviations.length ? 'intent_deviation' : 'compliant';
    const lines = ['study_id,condition_id,replicate,step,annotator,category,formal,note'];
    ds.forEach((d, i) => {
      const t = truth(d);
      lines.push(`${id},${d.conditionId},${d.replicate},${d.step},annotatorA,${t},${t === 'explicit_violation' ? 'violation' : 'compliant'},`);
      // 2人目の評価者は一部で判断が分かれる（専門家間の不一致）
      const other: EvalCategory = i % 15 === 0 && t === 'compliant' ? 'contested' : t;
      lines.push(`${id},${d.conditionId},${d.replicate},${d.step},annotatorB,${other},,`);
    });
    await expect(svc.addLabels(set.id, { csv: `study_id,condition_id,replicate,step,annotator,category\n${id},AND,0,999,a,compliant` }, actor)).rejects.toThrow(/存在しません/);
    await expect(svc.addLabels(set.id, { csv: `study_id,condition_id,replicate,step,annotator,category\n${id},AND,0,0,a,wrong` }, actor)).rejects.toThrow(/category/);
    expect((await svc.addLabels(set.id, { csv: lines.join('\n') }, actor)).added).toBe(ds.length * 2);
    const v = await svc.validateLabelSet(set.id);
    expect(v.isTestData).toBe(true);
    expect(v.gold.disputed).toBeGreaterThan(0);
    const engine = v.metrics.find((m) => m.evaluator.kind === 'deterministic')!;
    const criteria = v.metrics.find((m) => m.evaluator.kind === 'criteria')!;
    expect(engine.status).toBe('measured');
    // 規則エンジンは明示的違反を完全に判定するが、趣旨逸脱は評価しない（再現率 0）
    expect(engine.perClass.find((c) => c.category === 'explicit_violation')!.recall.p).toBe(1);
    if (criteria.perClass.some((c) => c.category === 'intent_deviation' && c.support > 0)) {
      expect(engine.perClass.find((c) => c.category === 'intent_deviation')!.recall.p).toBe(0);
      expect(criteria.perClass.find((c) => c.category === 'intent_deviation')!.recall.p).toBe(1);
    }
    expect(v.formalMetrics[0].binary.fp + v.formalMetrics[0].binary.fn).toBe(0);
    expect(v.metrics.some((m) => m.evaluator.kind === 'composite' && m.status === 'measured')).toBe(true);
    expect(v.annotatorAgreement[0].kappa).toBeLessThan(1);
    // 証拠の順序だけを変えた Judge どうしの比較（モックの Judge は順序の影響を受けない → 一致率 1）
    const order = v.bias.find((b) => b.kind === 'evidence_order')!;
    expect(order.agreement).toBe(1);
    expect(v.bias.some((b) => b.kind === 'annotator_disagreement')).toBe(true);
    // 固定すると変更できない（DB でも拒否）。新しい版はラベルを引き継ぐ
    await svc.freezeSet(set.id, actor);
    await expect(svc.addLabels(set.id, { csv: lines.slice(0, 2).join('\n') }, actor)).rejects.toThrow(/固定/);
    const { getDb } = await import('@/lib/server/db');
    await expect((await getDb()).query(`DELETE FROM rc_labels WHERE set_id = $1`, [set.id])).rejects.toThrow(/固定/);
    const v2 = (await svc.newVersion(set.id, actor))!;
    expect([v2.version, v2.labelCount, v2.frozen]).toEqual([2, ds.length * 2, false]);
  });

  it('逸脱を検出し、重大度と確信度・評価器・評価の版・再現情報を付ける。トレースが欠けても検出でき、その旨を記録する', async () => {
    const { detectFailures, getFailureLibrary } = await import('@/lib/server/research/failure/failures');
    const { listFailures } = await import('@/lib/server/storage/failureStore');
    const { getDb } = await import('@/lib/server/db');
    const id = ctx.studyId!;
    // トレースの欠損（保存期間の経過・記録の失敗を想定）
    await (await getDb()).query(`DELETE FROM rc_traces WHERE study_id = $1 AND condition_id = 'OR'`, [id]);
    await detectFailures(id, actor);
    const fs = await listFailures({ studyId: id, limit: 5000 });
    const cats = new Set(fs.map((f) => f.category));
    expect(cats.has('formal_violation')).toBe(true);
    const formal = fs.find((f) => f.category === 'formal_violation')!;
    expect([formal.severity, formal.confidence]).toEqual(['high', 'high']);
    expect(formal.evaluators!.length).toBeGreaterThanOrEqual(2);
    expect(formal.evaluationVersion).toBe('composite-v1');
    const missing = fs.find((f) => f.conditionId === 'OR')!;
    expect(missing.replay!.traceAvailable).toBe(false);
    expect(missing.traceId).toBeNull();
    // 評価器の不一致（人の確認が必要な判断）も逸脱の分類として登録される
    if (cats.has('evaluation_disagreement')) expect(fs.find((f) => f.category === 'evaluation_disagreement')!.confidence).toBe('low');
    // Failure Library の絞り込み
    const all = await getFailureLibrary();
    const onlyFormal = await getFailureLibrary({ category: 'formal_violation' });
    expect(onlyFormal.clusters.length).toBeGreaterThan(0);
    expect(onlyFormal.clusters.every((c) => c.category === 'formal_violation')).toBe(true);
    expect(onlyFormal.clusters.length).toBeLessThanOrEqual(all.clusters.length);
    expect(all.facets.models).toContain('mock');
    expect((await getFailureLibrary({ ruleKey: 'SPOOF-OR' })).clusters.every((c) => c.ruleKeys.includes('SPOOF-OR'))).toBe(true);
    expect((await getFailureLibrary({ q: 'SPOOF' })).clusters.length).toBeGreaterThan(0);
    expect(all.clusters[0].fixStatus).toBe('none');
    expect(all.clusters[0].industries).toContain('証券');
  });

  it('原因仮説は検証前は立証済みとしない。反証条件と必要な比較実験を持ち、比較実験の結果を仮説に関連付ける', async () => {
    const { getFailureLibrary } = await import('@/lib/server/research/failure/failures');
    const { generateHypotheses, scheduleExperiment, evaluateHypothesis } = await import('@/lib/server/research/failure/rootCause');
    const { waitForStudy } = await import('@/lib/server/research/study/studies');
    const lib = await getFailureLibrary({ category: 'intent_deviation' });
    const cluster = lib.clusters.find((c) => c.ruleKeys.includes('SPOOF-AND')) ?? lib.clusters[0];
    expect(cluster).toBeDefined();
    const hs = await generateHypotheses(cluster.fingerprint, actor);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) {
      expect(['HYPOTHESIS', 'SUPPORTED_BY_TRACE']).toContain(h.status);
      expect(h.verification).toBeNull();
      expect(h.falsification).toMatch(/支持されない/);
      expect(h.requiredExperiment).toMatch(/要因は原則1つ/);
      expect(h.cause).toBeTruthy();
    }
    const conj = hs.find((h) => h.factor === 'conjunction') ?? hs[0];
    const scheduled = await scheduleExperiment(conj.id, { replicates: 6, start: true }, actor);
    expect(scheduled.experimentStudyId).toBeTruthy();
    await waitForStudy(scheduled.experimentStudyId!);
    const evaluated = await evaluateHypothesis(conj.id, actor);
    expect(evaluated.verification!.studyId).toBe(scheduled.experimentStudyId);
    expect(['supported', 'refuted', 'inconclusive']).toContain(evaluated.verification!.result);
    if (evaluated.verification!.result === 'supported') expect(evaluated.verification!.summary).toMatch(/一般的な因果の立証ではありません/);
    expect(evaluated.effect!.isMock).toBe(true);
    const after = await getFailureLibrary({ cause: conj.cause });
    expect(after.clusters.some((c) => c.fingerprint === cluster.fingerprint)).toBe(true);
  });

  it('モデル API の障害: 失敗したセッションは結果に含めず、判断の記録を作らない', async () => {
    const { createProvider, setApiKey } = await import('@/lib/server/research/providers');
    const { createStudy, startStudy, waitForStudy } = await import('@/lib/server/research/study/studies');
    const { getStudy, listSessions, listDecisions } = await import('@/lib/server/storage/studyStore');
    const p = await createProvider({ type: 'openai_compatible', name: 'Down', baseUrl: mock.url, defaultModel: 'mock-model', maxRetries: 0 });
    await setApiKey(p.id, 'sk-test-valid-key-1234');
    mock.setHandler(() => ({ status: 503, body: { error: { message: 'Service unavailable' } } }));
    const s = await createStudy({ title: 'outage', conditions: [{ id: 'A', label: 'A' }], replicates: 2, market: { steps: 2 }, agent: { kind: 'model', providerId: p.id, model: 'mock-model' } }, actor);
    await startStudy(s.id, actor);
    await waitForStudy(s.id);
    const st = (await getStudy(s.id))!;
    const sessions = await listSessions(s.id);
    expect(sessions.every((x) => x.status === 'failed')).toBe(true);
    expect(sessions[0].error).toMatch(/障害|サーバー|server|503/i);
    expect(await listDecisions(s.id)).toHaveLength(0);
    expect(st.statusReason).toMatch(/失敗/);
  });

  it('実験の中断と再開: 一時停止後に再開しても、判断は重複・欠落しない', async () => {
    const { createStudy, startStudy, pauseStudy, resumeStudy, runStudySlice, waitForStudy } = await import('@/lib/server/research/study/studies');
    const { getDb } = await import('@/lib/server/db');
    const s = await createStudy({ title: 'pause', conditions: [{ id: 'A', label: 'A' }], replicates: 8, market: { steps: 5 } }, actor);
    await startStudy(s.id, actor);
    await runStudySlice(s.id, Date.now() + 5);
    await pauseStudy(s.id, actor);
    await resumeStudy(s.id, actor);
    await waitForStudy(s.id);
    const [{ n, u }] = await (await getDb()).query<{ n: number; u: number }>(`SELECT count(*)::int AS n, count(DISTINCT (condition_id, replicate, step))::int AS u FROM rc_decisions WHERE study_id = $1`, [s.id]);
    expect([n, u]).toEqual([40, 40]);
  });
});
