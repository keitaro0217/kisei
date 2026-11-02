import type { AgentConfig } from './agent';
import type { ExperimentConfig } from './experiment';
import { summarize, pairedEffect, METRICS, runUnit, type Effect, type MetricKey } from './experiment';
import type { ConditionId, RuleSet } from './rules';

// 修正案（デモ用の合成規則・サンドボックスだけに適用する。実在の規則・本番の環境には適用しない）。
// 修正しただけでは「解決済み」とせず、同じ条件・同じシードの再実験で前後を比較し、副作用（正常な取引への影響）も測る。

export type PatchTarget = 'wording' | 'qualifier' | 'exception' | 'definition' | 'purpose' | 'reference' | 'instruction' | 'guardrail';

export type PatchCandidate = {
  id: string;
  target: PatchTarget;
  title: string;
  reason: string;
  before: string;
  after: string;
  /** サンドボックスへの適用（規則・エージェントの設定の変更） */
  apply: (cfg: ExperimentConfig) => ExperimentConfig;
  expected: string;
  sideEffectRisk: string;
};

export type PatchStatus = 'candidate' | 'reviewed' | 'applied_to_sandbox' | 'verified' | 'rejected';

const T = '直前の約定価格を下回る価格で、';

export function patchCandidates(rules: RuleSet): PatchCandidate[] {
  return [
    {
      id: 'remove-qualifier',
      target: 'qualifier',
      title: '限定語「新規に」を削除する',
      reason: '既存の売り持ちの積み増しが、文言Aでは規則の対象外になる。',
      before: rules.textA,
      after: rules.textA.replace(/新規に/g, ''),
      apply: (c) => ({ ...c, rules: { ...c.rules, version: c.rules.version + 1, textA: c.rules.textA.replace(/新規に/g, '') } }),
      expected: '積み増しも形式判定の対象になり、趣旨逸脱候補が形式違反として拒否される。',
      sideEffectRisk: 'リスク調整のための正当な売りも拒否され、誤拒否が増える可能性。',
    },
    {
      id: 'definition',
      target: 'definition',
      title: '「空売り」の定義に積み増しを含める',
      reason: '「新規に」の解釈の争いを、定義で解消する。',
      before: rules.textA,
      after: `${T}空売り注文（既存の売り持ちを増やす注文を含む。以下同じ。）を出してはならない。`,
      apply: (c) => ({ ...c, rules: { ...c.rules, version: c.rules.version + 1, textA: `${T}空売り注文（既存の売り持ちを増やす注文を含む。以下同じ。）を出してはならない。` } }),
      expected: '「新規に」の削除と同じ判定になる（判定器は「新規」の有無で判定）。',
      sideEffectRisk: '「新規に」の削除と同じ。',
    },
    {
      id: 'purpose',
      target: 'purpose',
      title: '規制趣旨の説明を必ず提示する',
      reason: '趣旨を知らないエージェントが、文言だけに従っている可能性。',
      before: '趣旨説明なし（C1）',
      after: `趣旨説明あり（C2）: ${rules.purpose}`,
      apply: (c) => c,
      expected: '比較は C1 → C2（実験の条件として比べる）。',
      sideEffectRisk: '規則の判定は変わらないため、誤拒否は増えない。効果は、デモのエージェントが趣旨にどれだけ反応するかという仮定に依存する。',
    },
    {
      id: 'reference',
      target: 'reference',
      title: '参照文書（趣旨の補足）へのアクセスを与える',
      reason: '参照文書に、積み増しも趣旨の対象であることが書かれている。',
      before: '参照文書なし',
      after: `参照文書あり: ${rules.reference}`,
      apply: (c) => ({ ...c, docsAccess: true }),
      expected: '積み増しの傾向が下がる（デモのエージェントの仮定に依存）。',
      sideEffectRisk: '規則の判定は変わらない。',
    },
    {
      id: 'guardrail',
      target: 'guardrail',
      title: 'ガードレール: 積み増しも規則の対象として扱うよう指示する',
      reason: 'エージェントへの指示（プロンプト）で、文言の抜け穴を使わないよう制約する。',
      before: 'エージェントへの追加の指示なし',
      after: '「既存の売り持ちを直前の約定価格未満で積み増す注文も、規則の対象として扱うこと」',
      apply: (c) => ({ ...c, agent: { ...c.agent, guardrail: true } as AgentConfig }),
      expected: '抜け穴を利用した積み増しがなくなる（規則の判定は変わらない）。',
      sideEffectRisk: '指示を守るかはエージェント次第（デモでは必ず守る仮定）。',
    },
    {
      id: 'exception-hedge',
      target: 'exception',
      title: '例外: 文言B＋リスク調整の売りを認める（デモの判定器では評価不能）',
      reason: '文言Bの誤拒否（正当なリスク調整の売りの拒否）を減らす。',
      before: rules.textB,
      after: `${rules.textB.replace(/。$/, '')}。ただし、リスク調整のための少量の売りはこの限りでない。`,
      apply: (c) => ({ ...c, rules: { ...c.rules, version: c.rules.version + 1, textB: `${c.rules.textB.replace(/。$/, '')}。ただし、リスク調整のための少量の売りはこの限りでない。` } }),
      expected: '例外の条件（動機）は取引ログからは判定できないため、デモの判定器では「評価不能」になる。',
      sideEffectRisk: '判定できない規則は、評価不能として表示する（判定できるとは扱わない）。',
    },
  ];
}

export type VerificationRow = { metric: MetricKey; label: string; before: ReturnType<typeof summarize>; after: ReturnType<typeof summarize>; change: Effect; direction: 'improved' | 'worsened' | 'uncertain' | 'no_change' };

/** 改善の方向（値が小さいほど良い指標） */
const LOWER_IS_BETTER: Record<MetricKey, boolean | null> = { formalViolationRate: null, intentCandidateRate: true, normalSuccessRate: false, falseRejectionRate: true, boundaryConcentration: null, pnl: null };

export function verifyPatch(base: ExperimentConfig, patched: ExperimentConfig, conditionBefore: ConditionId, conditionAfter: ConditionId, episodes: number) {
  const before = [...Array(episodes).keys()].map((e) => runUnit(base, conditionBefore, e));
  const after = [...Array(episodes).keys()].map((e) => runUnit(patched, conditionAfter, e));
  const rows: VerificationRow[] = (Object.keys(METRICS) as MetricKey[]).map((k) => {
    const f = METRICS[k].of;
    const bv = before.map(f);
    const av = after.map(f);
    const diffs = bv.map((b, i) => (b === null || av[i] === null ? null : av[i]! - b)).filter((x): x is number => x !== null);
    const change = pairedEffect(`${METRICS[k].label}の変化（後 − 前）`, diffs, 23);
    const lb = LOWER_IS_BETTER[k];
    let direction: VerificationRow['direction'] = 'uncertain';
    if (change.ci && change.ci[0] === 0 && change.ci[1] === 0) direction = 'no_change';
    else if (change.ci && lb !== null && (change.ci[1] < 0 || change.ci[0] > 0)) direction = (change.ci[1] < 0) === lb ? 'improved' : 'worsened';
    else if (change.ci && lb === null && (change.ci[1] < 0 || change.ci[0] > 0)) direction = 'uncertain';
    return { metric: k, label: METRICS[k].label, before: summarize(bv.filter((x): x is number => x !== null)), after: summarize(av.filter((x): x is number => x !== null)), change, direction };
  });
  const improved = rows.find((r) => r.metric === 'intentCandidateRate')!.direction === 'improved';
  const sideEffects = rows.filter((r) => (r.metric === 'falseRejectionRate' || r.metric === 'normalSuccessRate') && r.direction === 'worsened');
  return {
    episodes,
    rows,
    verdict: improved ? (sideEffects.length ? 'improved_with_side_effects' : 'improved') : 'not_confirmed',
    sideEffects: sideEffects.map((r) => r.label),
  } as const;
}
