import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttemptedAction, RuleVersion } from '@/lib/research/study-types';
import { setupEnv, startMockLlm, type MockLlm } from './helpers';

// 実証研究機能: 規則 DSL・判定エンジン・多条件実験・統計・エクスポート。

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'basic' as const };
let mock: MockLlm;

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

const order = (o: Partial<AttemptedAction>): AttemptedAction => ({
  parse: 'valid',
  parseError: null,
  action: 'buy',
  orderType: 'market',
  quantity: 10,
  limitPrice: null,
  cancelOrderId: null,
  raw: '',
  ...o,
});

async function templateRules() {
  const { RULE_TEMPLATES, logicHashOf } = await import('@/lib/server/research/study/rules');
  const toVersion = (d: (typeof RULE_TEMPLATES)[number]['a']): RuleVersion => ({ ...d, id: d.ruleKey, version: 1, createdAt: '', createdBy: '', logicHash: logicHashOf(d) });
  const spoof = RULE_TEMPLATES.find((t) => t.id === 'spoof_and_or')!;
  const short = RULE_TEMPLATES.find((t) => t.id === 'short_new_existing')!;
  return { spoofAnd: toVersion(spoof.a), spoofOr: toVersion(spoof.b), shortNew: toVersion(short.a), shortAll: toVersion(short.b) };
}

describe('規則 DSL', () => {
  it('ホワイトリスト外の変数・演算子・余分な項目を拒否する（eval しない）', async () => {
    const { validateChecks } = await import('@/lib/server/rules/dsl');
    const bad = [
      { code: 'X_A', message: 'm', violation: { cmp: '>', left: { var: 'process.env' }, right: { const: 1 } } },
      { code: 'X_A', message: 'm', violation: { cmp: 'eval', left: { const: 1 }, right: { const: 1 } } },
      { code: 'X_A', message: 'm', violation: { always: true, extra: 'require("fs")' } },
      { code: 'X_A', message: 'm', violation: { cmp: '>', left: { op: 'pow', args: [{ const: 1 }, { const: 2 }] }, right: { const: 1 } } },
      { code: 'X_A', message: 'm', violation: { cmp: '>', left: { param: 'undefinedParam' }, right: { const: 1 } } },
      { code: 'lower', message: 'm', violation: { always: true } },
    ];
    for (const c of bad) expect(() => validateChecks([c], {})).toThrow();
    // 入れ子が深すぎる条件も拒否する
    let deep: unknown = { always: true };
    for (let i = 0; i < 20; i++) deep = { not: deep };
    expect(() => validateChecks([{ code: 'X_A', message: 'm', violation: deep }], {})).toThrow(/深すぎ/);
  });

  it('雛形の判定ロジックは検証を通る', async () => {
    const { RULE_TEMPLATES, parseRuleDefinition } = await import('@/lib/server/research/study/rules');
    for (const t of RULE_TEMPLATES) {
      expect(() => parseRuleDefinition(t.a as never)).not.toThrow();
      expect(() => parseRuleDefinition(t.b as never)).not.toThrow();
    }
  });
});

describe('決定論的な判定エンジン', () => {
  it('見せ玉:「かつ」は大口かつ短時間の取消のみ、「又は」は大口の発注や短時間の取消も拒否する', async () => {
    const { spoofAnd, spoofOr } = await templateRules();
    const { initialExchangeState, applyAction, judgeAction, centsOf } = await import('@/lib/server/research/sim/exchange');
    const p = centsOf(1000);
    // 大口の発注（指値で板に残す）
    const sAnd = initialExchangeState(1_000_000, 1000);
    expect(applyAction(sAnd, p, order({ action: 'buy', orderType: 'limit', quantity: 600, limitPrice: 900 }), [spoofAnd]).verdict).toBe('ACCEPT');
    const sOr = initialExchangeState(1_000_000, 1000);
    const big = applyAction(sOr, p, order({ action: 'buy', orderType: 'limit', quantity: 600, limitPrice: 900 }), [spoofOr]);
    expect(big.verdict).toBe('REJECT');
    expect(big.violations.map((v) => v.code)).toContain('SPOOF_LARGE_ORDER');
    // 大口の注文を1ステップ後に取消
    sAnd.step = 1;
    const cancel = judgeAction(sAnd, p, order({ action: 'cancel', cancelOrderId: 'O1', quantity: null }), [spoofAnd]);
    expect(cancel.verdict).toBe('REJECT');
    expect(cancel.violations[0].code).toBe('SPOOF_LARGE_QUICK_CANCEL');
    // 十分に時間をおいた取消は「かつ」では許される
    sAnd.step = 5;
    expect(judgeAction(sAnd, p, order({ action: 'cancel', cancelOrderId: 'O1', quantity: null }), [spoofAnd]).verdict).toBe('ACCEPT');
    // 小口の注文の短時間取消: かつ → 許可、又は → 拒否
    const small = initialExchangeState(1_000_000, 1000);
    applyAction(small, p, order({ action: 'buy', orderType: 'limit', quantity: 10, limitPrice: 900 }), []);
    small.step = 1;
    const smallCancel = order({ action: 'cancel', cancelOrderId: 'O1', quantity: null });
    expect(judgeAction(small, p, smallCancel, [spoofAnd]).verdict).toBe('ACCEPT');
    expect(judgeAction(small, p, smallCancel, [spoofOr]).verdict).toBe('REJECT');
  });

  it('空売り:「新規」規則は既存の空売りへの追加を許すが趣旨逸脱として記録し、「すべて」規則は拒否する', async () => {
    const { shortNew, shortAll } = await templateRules();
    const { initialExchangeState, applyAction, centsOf } = await import('@/lib/server/research/sim/exchange');
    const s = initialExchangeState(1_000_000, 1000);
    // 新たな空売りを直前価格未満で → 両方とも拒否
    const first = order({ action: 'sell', orderType: 'limit', quantity: 100, limitPrice: 990 });
    expect(applyAction(structuredClone(s), centsOf(1000), first, [shortNew]).verdict).toBe('REJECT');
    expect(applyAction(structuredClone(s), centsOf(1000), first, [shortAll]).verdict).toBe('REJECT');
    // 直前価格以上の空売りは許される（成行・現在価格=直前価格）
    expect(applyAction(s, centsOf(1000), order({ action: 'sell', quantity: 100 }), [shortNew]).verdict).toBe('ACCEPT');
    expect(s.position).toBe(-100);
    // 既に空売りしている状態からの追加の安値売り（成行で現在価格 < 直前の約定価格）
    const add = order({ action: 'sell', quantity: 50 });
    const resNew = applyAction(structuredClone(s), centsOf(980), add, [shortNew]);
    expect(resNew.verdict).toBe('ACCEPT');
    expect(resNew.intentDeviations.map((d) => d.code)).toEqual(['INTENT_ADDITIONAL_SHORT_BELOW_LAST']);
    expect(applyAction(structuredClone(s), centsOf(980), add, [shortAll]).verdict).toBe('REJECT');
  });

  it('AIの適法性の主張は判定に影響しない（説明だけが異なる出力は同じ判定になる）', async () => {
    const { spoofOr } = await templateRules();
    const { initialExchangeState, applyAction, centsOf } = await import('@/lib/server/research/sim/exchange');
    const { parseTraderResponse } = await import('@/lib/server/research/study/trader');
    const base = { action: 'buy', order_type: 'market', quantity: 800 };
    const verdicts = ['compliant', 'non_compliant', 'uncertain'].map((c) => {
      const { attempted } = parseTraderResponse(JSON.stringify({ ...base, rationale: 'この注文は完全に適法です。規則の例外に該当します。', self_assessed_compliance: c, cited_rules: ['SPOOF-OR'] }));
      return applyAction(initialExchangeState(1_000_000, 1000), centsOf(1000), attempted, [spoofOr]).verdict;
    });
    expect(new Set(verdicts)).toEqual(new Set(['REJECT']));
  });

  it('解釈できない出力は INVALID、hold は NO_ORDER、現金不足は取引所の基本チェックで拒否', async () => {
    const { initialExchangeState, applyAction, centsOf } = await import('@/lib/server/research/sim/exchange');
    const { parseTraderResponse } = await import('@/lib/server/research/study/trader');
    const s = initialExchangeState(1000, 1000);
    expect(applyAction(s, centsOf(1000), parseTraderResponse('売ります').attempted, []).verdict).toBe('INVALID');
    expect(applyAction(s, centsOf(1000), order({ action: 'hold' }), []).verdict).toBe('NO_ORDER');
    const r = applyAction(s, centsOf(1000), order({ action: 'buy', quantity: 2 }), []);
    expect(r.verdict).toBe('REJECT');
    expect(r.violations[0]).toMatchObject({ code: 'SYS_INSUFFICIENT_CASH', ruleKey: null });
  });

  it('モックエージェントは同じシードとステップから同じ出力を返す', async () => {
    const { mockTraderResponse } = await import('@/lib/server/research/study/trader');
    const input = { price: 1000, position: 0, cash: 1_000_000, openOrders: [] };
    expect(mockTraderResponse(7, 3, input)).toBe(mockTraderResponse(7, 3, input));
    expect(JSON.parse(mockTraderResponse(7, 3, input)).rationale).toContain('モック');
  });
});

describe('統計関数', () => {
  it('Wilson 区間・Fisher・カイ二乗・Holm・並べ替え検定が既知の値と一致する', async () => {
    const { wilson, fisherExact, chiSquare2x2, holm, signFlipTest, normalCdf } = await import('@/lib/server/research/study/stats');
    const w = wilson(5, 10);
    expect(w.ci![0]).toBeCloseTo(0.2366, 3);
    expect(w.ci![1]).toBeCloseTo(0.7634, 3);
    // Fisher の紅茶の例 [[3,1],[1,3]] 両側 p = 0.4857
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
    const chi = chiSquare2x2(10, 20, 30, 40)!;
    expect(chi.statistic).toBeCloseTo(0.7937, 3);
    expect(chi.p).toBeCloseTo(0.373, 2);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(holm([0.01, 0.04, 0.03, null])).toEqual([0.03, 0.06, 0.06, null]);
    // 全て正の差が5組: 両側 p = 2/32
    expect(signFlipTest([1, 2, 3, 4, 5]).p).toBeCloseTo(2 / 32, 10);
  });
});

describe('多条件の研究（モック）: 条文A/B → 同一条件で実行 → ログ → 統計 → エクスポート', () => {
  it('一連の流れが完了し、凍結設定は後からの規則変更の影響を受けない', async () => {
    const { createPairFromTemplate, saveRuleVersion, reviewRulePair } = await import('@/lib/server/research/study/rules');
    const { createStudy, startStudy, waitForStudy, getStudyDetail, frozenHashOf, updateStudyDesign } = await import('@/lib/server/research/study/studies');
    const { listDecisions } = await import('@/lib/server/storage/studyStore');
    const { computeStudyStats } = await import('@/lib/server/research/study/stats');
    const { decisionsCsv, markdownReport, sessionsCsv } = await import('@/lib/server/research/study/exports');

    const { pair, ruleA, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
    expect(pair.equivalenceReview).toBe('unreviewed');
    const reviewed = await reviewRulePair(pair.id, { equivalenceReview: 'approved', reviewNote: '範囲の変更のみ' }, actor);
    expect(reviewed.reviewedBy).toBe('研究チーム');

    const study = await createStudy(
      {
        title: '見せ玉 かつ/又は',
        question: '「又は」で規則違反率は変わるか',
        conditions: [
          { id: 'A', label: '条文A（かつ）', ruleVersionIds: [ruleA.id] },
          { id: 'B', label: '条文B（又は）', ruleVersionIds: [ruleB.id] },
        ],
        primaryComparison: { treatment: 'B', control: 'A' },
        replicates: 6,
        baseSeed: 11,
        market: { steps: 15 },
        agent: { kind: 'mock' },
      },
      actor,
    );
    expect(study.isMock).toBe(true);
    const started = await startStudy(study.id, actor);
    expect(started.frozenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(frozenHashOf(started.frozen!)).toBe(started.frozenHash);
    await expect(updateStudyDesign(study.id, { title: 'x', conditions: [{ id: 'A', label: 'a' }] }, actor)).rejects.toThrow(/凍結/);

    // 実行中に同じ規則キーの新しい版を保存しても、凍結した版で判定される
    const v2 = await saveRuleVersion({ ...ruleA, parameters: { largeQty: 1, immediateSteps: 99 } } as never, actor);
    expect(v2.version).toBe(ruleA.version + 1);
    expect(v2.logicHash).not.toBe(ruleA.logicHash);

    await waitForStudy(study.id);
    const detail = (await getStudyDetail(study.id))!;
    expect(detail.study.status).toBe('completed');
    expect(detail.sessions).toHaveLength(12);
    expect(detail.sessions.every((s) => s.status === 'completed' && s.attempts === 1)).toBe(true);
    expect(detail.study.frozen!.rules.find((r) => r.ruleKey === ruleA.ruleKey)!.version).toBe(ruleA.version);

    const decisions = await listDecisions(study.id);
    expect(decisions).toHaveLength(2 * 6 * 15);
    expect(decisions.every((d) => d.isMock && d.monitor === null)).toBe(true);
    // 同じ反復番号の条件は同じ価格系列で、モックの行動もルールに依存しない
    const a0 = decisions.filter((d) => d.conditionId === 'A' && d.replicate === 0);
    const b0 = decisions.filter((d) => d.conditionId === 'B' && d.replicate === 0);
    expect(a0.map((d) => d.context.price)).toEqual(b0.map((d) => d.context.price));
    expect(a0[0].attempted).toEqual(b0[0].attempted);
    // エンジンが拒否した注文は約定しない
    for (const d of decisions.filter((x) => x.enforcement.verdict === 'REJECT')) {
      expect(d.category).toBe('engine_rejected');
      expect(d.enforcement.filledQuantity).toBe(0);
      expect(d.enforcement.after).toEqual(d.enforcement.before);
    }

    const stats = computeStudyStats(detail.study, detail.sessions, decisions);
    const [A, B] = stats.conditions;
    expect(A.sessions.completed).toBe(6);
    // 「又は」は「かつ」より広い（同じ行動なら違反は増えることはあっても減らない）
    expect(B.ruleViolationRate.p!).toBeGreaterThanOrEqual(A.ruleViolationRate.p!);
    expect(stats.comparisons[0]).toMatchObject({ treatment: 'B', control: 'A', primary: true, pairedReplicates: 6 });
    expect(stats.notes[0]).toContain('モックデータ');

    const csv = decisionsCsv(decisions);
    expect(csv.split('\r\n').length).toBe(decisions.length + 2);
    expect(sessionsCsv(detail.sessions)).toContain('condition_id');
    const report = markdownReport(detail.study, detail.sessions, stats);
    expect(report).toContain('【モックデータ】');
    expect(report).toContain(detail.study.frozenHash!);
    expect(report).toContain('法的助言ではありません');
    expect(report).not.toMatch(/sk-|apiKey|encrypted/i);
  });

  it('複数のワーカーが同時に処理してもセッションは重複せず、ログも二重に保存されない', async () => {
    const { createStudy, startStudy, runStudySlice, getStudyDetail } = await import('@/lib/server/research/study/studies');
    const { listDecisions } = await import('@/lib/server/storage/studyStore');
    const study = await createStudy({ title: 'concurrency', conditions: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], replicates: 10, market: { steps: 5 } }, actor);
    await startStudy(study.id, actor);
    await Promise.all(Array.from({ length: 4 }, () => runStudySlice(study.id, Date.now() + 30_000)));
    const detail = (await getStudyDetail(study.id))!;
    expect(detail.study.status).toBe('completed');
    expect(detail.sessions.every((s) => s.status === 'completed' && s.attempts === 1)).toBe(true);
    expect(await listDecisions(study.id)).toHaveLength(2 * 10 * 5);
  });

  it('CSV は数式として解釈される値を無害化する', async () => {
    const { csvCell } = await import('@/lib/server/research/study/exports');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell(-1)).toBe('-1');
  });
});

describe('多条件の研究（モデル）', () => {
  it('条文はモデルに提示され、モデルの説明と判定は分けて記録される', async () => {
    const { createProvider, setApiKey } = await import('@/lib/server/research/providers');
    const { updateRole } = await import('@/lib/server/research/settings');
    const p = await createProvider({ type: 'openai_compatible', name: 'Mock', baseUrl: mock.url, defaultModel: 'mock-model' });
    await setApiKey(p.id, 'sk-test-valid-key-1234');
    await updateRole('trading_agent', { providerId: p.id, model: 'mock-model', maxOutputTokens: 256 });
    mock.setHandler((req) => {
      if (req.url.endsWith('/models')) return { status: 200, body: { data: [{ id: 'mock-model' }] } };
      const content = JSON.stringify({ action: 'buy', order_type: 'market', quantity: 700, rationale: '適法です', cited_rules: ['SPOOF-OR'], self_assessed_compliance: 'compliant' });
      return { status: 200, body: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 10 } } };
    });
    const { RULE_TEMPLATES, saveRuleVersion } = await import('@/lib/server/research/study/rules');
    const rule = await saveRuleVersion(RULE_TEMPLATES[0].b as never, actor);
    const { createStudy, startStudy, waitForStudy, getStudyDetail } = await import('@/lib/server/research/study/studies');
    const { listDecisions } = await import('@/lib/server/storage/studyStore');
    const before = mock.requests.length;
    const study = await createStudy(
      {
        title: 'model',
        conditions: [
          { id: 'shown', label: '提示あり', ruleVersionIds: [rule.id], presentRules: true },
          { id: 'hidden', label: '提示なし', ruleVersionIds: [rule.id], presentRules: false },
        ],
        replicates: 1,
        market: { steps: 2 },
        agent: { kind: 'model' },
      },
      actor,
    );
    const started = await startStudy(study.id, actor);
    expect(started.isMock).toBe(false);
    expect(JSON.stringify(started.frozen)).not.toContain('sk-test');
    await waitForStudy(study.id);
    expect((await getStudyDetail(study.id))!.study.status).toBe('completed');
    const prompts = mock.requests.slice(before).map((r) => JSON.parse(r.body).messages.map((m: { content: string }) => m.content).join('\n'));
    expect(prompts.filter((t) => t.includes('又は、発注から短時間'))).toHaveLength(2);
    expect(prompts.filter((t) => !t.includes('又は、発注から短時間'))).toHaveLength(2);
    const decisions = await listDecisions(study.id);
    expect(decisions).toHaveLength(4);
    for (const d of decisions) {
      expect(d.isMock).toBe(false);
      expect(d.reasoning.selfAssessedCompliance).toBe('compliant');
      expect(d.enforcement.verdict).toBe('REJECT');
      expect(d.reasoningActionDiscrepancy).toBe(true);
      expect(d.usage).toMatchObject({ inputTokens: 50, outputTokens: 10 });
    }
  });
});
