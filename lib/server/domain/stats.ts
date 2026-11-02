import type { DomainStepRecord, EpisodeOutcome } from '@/lib/domain/model';
import type { Study, StudySession } from '@/lib/research/study-types';
import { mulberry32 } from '../research/sim/market';
import { signFlipTest, wilson, type Proportion } from '../research/study/stats';

// 金融以外のドメインの研究の集計。
// - 比率（形式違反率・趣旨逸脱率・正常処理の成功率）は、ステップを独立と仮定した参考の Wilson 区間。
// - 条件間の差は、独立な単位である反復（セッション）ごとの率の差で推定する（同じセッション内の連続した行動を独立に扱わない）。

export type DomainConditionStats = {
  conditionId: string;
  label: string;
  sessions: number;
  steps: number;
  /** 行動（待つ・見送りを除く）のうち、規則の違反で拒否された割合 */
  formalViolationRate: Proportion;
  /** 形式的に受理された行動のうち、規則の目的からの逸脱の基準に該当した割合 */
  intentDeviationRate: Proportion;
  /** 行動のうち、規則・システムの両方で受理された割合（正常な業務の処理） */
  normalSuccessRate: Proportion;
  invalidRate: Proportion;
  meanReward: number | null;
  /** エピソードの指標の平均（業務の目標の達成度など） */
  metrics: Record<string, number>;
};

export type DomainComparison = {
  treatment: string;
  control: string;
  metric: 'formal_violation_rate' | 'intent_deviation_rate';
  pairedReplicates: number;
  diff: number | null;
  ci: [number, number] | null;
  permutationP: number | null;
};

const isAction = (s: DomainStepRecord) => s.action.type !== 'wait' && s.action.type !== 'hold';
const ruleViolation = (s: DomainStepRecord) => s.formal.violations.some((v) => v.ruleKey !== null);

function perReplicateRate(steps: DomainStepRecord[], cond: string, metric: DomainComparison['metric']): Map<number, number> {
  const byRep = new Map<number, DomainStepRecord[]>();
  for (const s of steps.filter((x) => x.conditionId === cond)) byRep.set(s.replicate, [...(byRep.get(s.replicate) ?? []), s]);
  const out = new Map<number, number>();
  for (const [rep, ss] of byRep) {
    if (metric === 'formal_violation_rate') {
      const acts = ss.filter(isAction);
      if (acts.length) out.set(rep, acts.filter(ruleViolation).length / acts.length);
    } else {
      const acc = ss.filter((x) => x.formal.verdict === 'ACCEPT');
      if (acc.length) out.set(rep, acc.filter((x) => x.intent.deviations.length > 0).length / acc.length);
    }
  }
  return out;
}

export function compareDomainConditions(steps: DomainStepRecord[], treatment: string, control: string, metric: DomainComparison['metric']): DomainComparison {
  const t = perReplicateRate(steps, treatment, metric);
  const c = perReplicateRate(steps, control, metric);
  const diffs = [...t.keys()].filter((r) => c.has(r)).map((r) => t.get(r)! - c.get(r)!);
  if (diffs.length === 0) return { treatment, control, metric, pairedReplicates: 0, diff: null, ci: null, permutationP: null };
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  let ci: [number, number] | null = null;
  if (diffs.length >= 2) {
    const rand = mulberry32(4242);
    const bs: number[] = [];
    for (let b = 0; b < 2000; b++) {
      let sum = 0;
      for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(rand() * diffs.length)];
      bs.push(sum / diffs.length);
    }
    bs.sort((a, b) => a - b);
    ci = [bs[Math.floor(bs.length * 0.025)], bs[Math.floor(bs.length * 0.975)]];
  }
  return { treatment, control, metric, pairedReplicates: diffs.length, diff: mean, ci, permutationP: signFlipTest(diffs).p };
}

export function computeDomainStats(study: Study, sessions: StudySession[], steps: DomainStepRecord[]) {
  const design = study.frozen?.design ?? study.design;
  const completed = new Set(sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
  const done = steps.filter((s) => completed.has(`${s.conditionId}/${s.replicate}`));
  const conditions: DomainConditionStats[] = design.conditions.map((c) => {
    const ss = done.filter((s) => s.conditionId === c.id);
    const acts = ss.filter(isAction);
    const accepted = acts.filter((s) => s.formal.verdict === 'ACCEPT');
    const outcomes = sessions
      .filter((s) => s.conditionId === c.id && s.status === 'completed')
      .map((s) => s.domainOutcome)
      .filter((o): o is EpisodeOutcome => Boolean(o));
    const metricKeys = [...new Set(outcomes.flatMap((o) => Object.keys(o.metrics)))];
    return {
      conditionId: c.id,
      label: c.label,
      sessions: outcomes.length,
      steps: ss.length,
      formalViolationRate: wilson(acts.filter(ruleViolation).length, acts.length),
      intentDeviationRate: wilson(accepted.filter((s) => s.intent.deviations.length > 0).length, accepted.length),
      normalSuccessRate: wilson(accepted.length, acts.length),
      invalidRate: wilson(ss.filter((s) => s.action.parse === 'invalid').length, ss.length),
      meanReward: outcomes.length ? outcomes.reduce((a, o) => a + o.reward, 0) / outcomes.length : null,
      metrics: Object.fromEntries(metricKeys.map((k) => [k, Math.round((outcomes.reduce((a, o) => a + (o.metrics[k] ?? 0), 0) / outcomes.length) * 1000) / 1000])),
    };
  });
  const pc = design.primaryComparison;
  const comparisons = pc
    ? (['formal_violation_rate', 'intent_deviation_rate'] as const).map((m) => compareDomainConditions(done, pc.treatment, pc.control, m))
    : [];
  return {
    domain: design.domain ?? 'financial_market',
    conditions,
    comparisons,
    notes: [
      '比率の区間はステップを独立と仮定した参考値です。条件間の差は、反復（セッション）単位の対応のあるブートストラップ区間と並べ替え検定で示します。',
      ...(study.isMock ? ['モックのエージェントの結果です。AI の行動の研究結果として解釈しないでください。'] : []),
    ],
  };
}
