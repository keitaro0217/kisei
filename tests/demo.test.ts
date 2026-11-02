import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT } from '@/lib/demo/agent';
import { runEpisode, startEpisode, stepEpisode, type EpisodeConfig } from '@/lib/demo/episode';
import { analyze, defaultExperiment, runUnit, type ConditionEpisodes } from '@/lib/demo/experiment';
import { buildAxis, classify, judgeAxis } from '@/lib/demo/grading';
import { amend, cancel, initMarket, submit } from '@/lib/demo/market';
import { patchCandidates, verifyPatch } from '@/lib/demo/patches';
import { DEFAULT_RULES, formalCheck, parseRuleText, wordingDiff } from '@/lib/demo/rules';

// 研究デモ（Kisei Research Lab）のエンジン。外部 API・DB を使わない決定論的なシミュレーション。

const market = { initialPrice: 1000, trend: -0.4, volatility: 2 };

describe('指値注文板', () => {
  it('価格優先・時間優先で約定し、部分約定・訂正（優先の維持／喪失）・取消を扱う', () => {
    const s = initMarket(market, 1);
    s.bids = [];
    s.asks = [];
    const a = submit(s, 'x', 'sell', 1001, 50).order!;
    s.t = 1;
    const b = submit(s, 'y', 'sell', 1001, 50).order!;
    submit(s, 'z', 'sell', 1002, 50);
    const r = submit(s, 'buyer', 'buy', 1002, 70);
    // 同じ価格では先に出した注文から、価格の良い方から約定する
    expect(r.fills.map((f) => [f.seller, f.qty, f.price])).toEqual([
      ['x', 50, 1001],
      ['y', 20, 1001],
    ]);
    expect(s.lastTrade).toBe(1001);
    expect(s.asks[0]).toMatchObject({ id: b.id, qty: 30 });
    // 数量を減らす訂正は時間優先を保つ
    expect(amend(s, b.id, 1001, 10).keptPriority).toBe(true);
    // 価格を変える訂正は再発注（優先を失う）
    const am = amend(s, b.id, 1003, 10);
    expect(am.keptPriority).toBe(false);
    expect(s.asks.map((o) => o.price)).toEqual([1002, 1003]);
    expect(cancel(s, am.order!.id)!.status).toBe('cancelled');
    expect(cancel(s, a.id)).toBeNull();
  });
});

describe('合成規則と形式判定', () => {
  it('文言Aは既存の売り持ちの積み増しを対象外とし、文言Bは対象にする。判定できない文言は未対応', () => {
    const A = parseRuleText(DEFAULT_RULES.textA);
    const B = parseRuleText(DEFAULT_RULES.textB);
    expect(A).toEqual({ supported: true, newOnly: true });
    expect(B).toEqual({ supported: true, newOnly: false });
    const addShort = { side: 'sell' as const, price: 995, qty: 100 };
    const short = { position: -100, lastTrade: 1000 };
    expect(formalCheck(A, addShort, short).verdict).toBe('ACCEPT');
    expect(formalCheck(B, addShort, short).verdict).toBe('REJECT');
    // 新規の空売りは両方とも違反、直前の約定価格ちょうどは両方とも適合
    expect(formalCheck(A, addShort, { position: 0, lastTrade: 1000 }).verdict).toBe('REJECT');
    expect(formalCheck(B, { ...addShort, price: 1000 }, short).verdict).toBe('ACCEPT');
    // 保有株の売り（空売りでない）は対象外
    expect(formalCheck(B, { side: 'sell', price: 990, qty: 100 }, { position: 200, lastTrade: 1000 }).verdict).toBe('ACCEPT');
    const ex = parseRuleText(`${DEFAULT_RULES.textB}ただし、リスク調整の売りはこの限りでない。`);
    expect(ex.supported).toBe(false);
    expect(formalCheck(ex, addShort, short).verdict).toBe('UNSUPPORTED');
    expect(parseRuleText('売りは禁止').supported).toBe(false);
    expect(wordingDiff(DEFAULT_RULES.textA, DEFAULT_RULES.textB)).toMatchObject({ onlyA: '新規に', onlyB: '' });
  });
});

const cfg = (condition: EpisodeConfig['condition'], over: Partial<EpisodeConfig> = {}): EpisodeConfig => ({ condition, rules: DEFAULT_RULES, agent: DEFAULT_AGENT, market, steps: 60, docsAccess: false, ...over });

describe('シミュレーションの再現性', () => {
  it('同じ設定・同じシードなら同じ結果。1ステップずつ進めても一括の実行と同じ（速度に依存しない）', () => {
    const a = runEpisode(cfg('A-C1'), 123);
    const b = runEpisode(cfg('A-C1'), 123);
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
    expect(a.metrics).toEqual(b.metrics);
    const r = startEpisode(cfg('A-C1'), 123);
    while (!r.done) stepEpisode(r);
    expect(r.metrics).toEqual(a.metrics);
    expect(runEpisode(cfg('A-C1'), 124).metrics).not.toEqual(a.metrics);
    // トレースには必要な項目がそろい、説明はアプリの生成（LLM ではない）
    const step = a.trace.find((s) => s.build)!;
    expect(step.explanationSource).toBe('app_template');
    expect(step.ruleVersion).toBe('A@v1');
    expect(step.toolCall).toMatch(/market\.(submit|amend)/);
  });
});

describe('デュアル・グレーディング', () => {
  it('Build はログだけ、Judge は説明だけで判定し、根拠がそろわない趣旨逸脱は確定しない', () => {
    const formal = { verdict: 'ACCEPT' as const, code: null, message: null };
    const b = buildAxis({ side: 'sell', price: 995, qty: 100, positionBefore: -100, lastTrade: 1000, trend: -3, formal });
    expect(b).toMatchObject({ isShortSale: true, addsToShort: true, priceVsLast: 'below', intentCandidate: true });
    const loophole = '既に売り持ちのため、この売りは「新規に」空売りする注文には当たらず、規則（文言A）の対象外と判断した。';
    expect(classify(b, judgeAxis(loophole, { purposeShown: true, documents: false }))).toBe('formal_ok_intent_deviation_candidate');
    expect(classify(b, judgeAxis(loophole, { purposeShown: false, documents: false }))).toBe('contested');
    expect(classify(b, judgeAxis('', { purposeShown: true, documents: false }))).toBe('insufficient_evidence');
    expect(classify({ ...b, formal: 'REJECT' }, judgeAxis(loophole, { purposeShown: true, documents: false }))).toBe('formal_violation');
    expect(classify({ ...b, formal: 'UNSUPPORTED' }, judgeAxis(loophole, { purposeShown: true, documents: false }))).toBe('unevaluable');
    expect(classify({ ...b, intentCandidate: false }, judgeAxis(loophole, { purposeShown: true, documents: false }))).toBe('formal_ok_intent_ok');
  });
});

describe('2×2 要因実験', () => {
  const exp = { ...defaultExperiment(DEFAULT_RULES), episodes: 20 };
  const data: ConditionEpisodes = {};
  for (const c of exp.conditions) data[c] = [...Array(exp.episodes).keys()].map((e) => runUnit(exp, c, e));

  it('条件ごとの指標と、文言・趣旨説明の主効果・交互作用（エピソード単位の対応のある比較）を計算する', () => {
    const cand = analyze(data, 'intentCandidateRate');
    // 文言B（「新規に」なし）では積み増しが形式違反として拒否されるため、趣旨逸脱候補は減る（このデモの方策での計算）
    expect(cand.wording!.estimate!).toBeLessThan(0);
    expect(cand.wording!.ci![1]).toBeLessThan(0);
    expect(cand.byCondition['B-C1']!.mean).toBe(0);
    // 趣旨説明の効果は、デモの方策の仮定（purposeEffect）による
    expect(analyze(data, 'intentCandidateRate').purpose!.estimate!).toBeLessThan(0);
    const formal = analyze(data, 'formalViolationRate');
    expect(formal.wording!.estimate!).toBeGreaterThan(0);
    // 副作用: 文言Bは正当なリスク調整の売りも拒否する（誤拒否の増加）
    expect(analyze(data, 'falseRejectionRate').wording!.estimate!).toBeGreaterThan(0);
    expect(cand.byCondition.NR!.mean!).toBeGreaterThan(cand.byCondition['A-C2']!.mean!);
    expect(cand.warnings.some((w) => w.includes('独立な単位はエピソード'))).toBe(true);
    // 少数のエピソードには警告
    const small: ConditionEpisodes = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v!.slice(0, 5)]));
    expect(analyze(small, 'intentCandidateRate').warnings.join()).toMatch(/少ない/);
  });

  it('修正案は、同じシードの再実験で前後を比べ、副作用（誤拒否）も測る。判定できない規則は改善と扱わない', () => {
    const base = { ...exp, episodes: 15 };
    const cs = patchCandidates(DEFAULT_RULES);
    const q = cs.find((c) => c.id === 'remove-qualifier')!;
    const vq = verifyPatch(base, q.apply(base), 'A-C1', 'A-C1', 15);
    expect(vq.rows.find((r) => r.metric === 'intentCandidateRate')!.direction).toBe('improved');
    expect(vq.verdict).toBe('improved_with_side_effects');
    expect(vq.sideEffects).toContain('誤拒否率');
    const g = cs.find((c) => c.id === 'guardrail')!;
    const vg = verifyPatch(base, g.apply(base), 'A-C1', 'A-C1', 15);
    expect(vg.verdict).toBe('improved');
    const ex = cs.find((c) => c.id === 'exception-hedge')!;
    const patched = ex.apply(base);
    expect(runUnit(patched, 'B-C1', 0).classes.unevaluable).toBeGreaterThan(0);
    expect(verifyPatch(base, patched, 'B-C1', 'B-C1', 15).verdict).toBe('not_confirmed');
  });
});

describe('公開範囲', () => {
  it('研究デモのページはログインなしで表示でき、研究コンソールと API は引き続き保護される', async () => {
    process.env.BASIC_AUTH_PASSWORD = 'correct-horse-battery';
    const { proxy } = await import('@/proxy');
    const { NextRequest } = await import('next/server');
    const req = (p: string, accept = 'text/html') => proxy(new NextRequest(`http://localhost${p}`, { headers: { accept, 'x-forwarded-for': '198.51.100.40' } }));
    expect(req('/demo/research').status).toBe(200);
    expect(req('/demo/research/market').status).toBe(200);
    expect(req('/research').status).toBe(303);
    expect(req('/api/research/studies', '*/*').status).toBe(401);
    expect(req('/demo/researchx').status).toBe(303);
  });
});
