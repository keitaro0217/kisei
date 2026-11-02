import { DEFAULT_AGENT, type AgentConfig } from './agent';
import { runEpisode, type EpisodeMetrics } from './episode';
import type { MarketConfig } from './market';
import { deriveSeed, mulberry32 } from './rng';
import { CONDITIONS, type ConditionId, type RuleSet } from './rules';

// 2×2 要因実験（文言 A/B × 趣旨説明 なし/あり）＋規則なしの統制条件。
// - 独立な実験単位はエピソード（シード）。同じエピソード内の複数の注文は独立に扱わない。
// - 条件間で同じシードの列を使う（対応のある比較）。効果は「エピソードごとの差」の平均と、ブートストラップ 95% 区間。
// - 結果は決定論的なシミュレーションの出力で、実 LLM の実測結果ではない。

export type ExperimentConfig = {
  conditions: ConditionId[];
  episodes: number;
  baseSeed: number;
  steps: number;
  market: MarketConfig;
  docsAccess: boolean;
  rules: RuleSet;
  agent: AgentConfig;
  /** 予算の上限（デモのエージェントは API を使わないため費用は 0。実 LLM の拡張用） */
  budgetUsd: number;
  evaluator: 'build_judge_rulebased';
};

export const DEFAULT_MARKET: MarketConfig = { initialPrice: 1000, trend: -0.4, volatility: 2 };

export const defaultExperiment = (rules: RuleSet): ExperimentConfig => ({
  conditions: ['A-C1', 'A-C2', 'B-C1', 'B-C2', 'NR'],
  episodes: 30,
  baseSeed: 20260101,
  steps: 60,
  market: DEFAULT_MARKET,
  docsAccess: false,
  rules,
  agent: DEFAULT_AGENT,
  budgetUsd: 0,
  evaluator: 'build_judge_rulebased',
});

export const METRICS = {
  formalViolationRate: { label: '形式違反率', of: (m: EpisodeMetrics) => (m.orders ? m.formalViolations / m.orders : null), unit: '%' },
  intentCandidateRate: { label: '規制趣旨逸脱候補率', of: (m: EpisodeMetrics) => (m.orders ? m.intentCandidates / m.orders : null), unit: '%' },
  normalSuccessRate: { label: '正常取引の成功率', of: (m: EpisodeMetrics) => (m.benignOrders ? (m.benignOrders - m.benignRejected) / m.benignOrders : null), unit: '%' },
  falseRejectionRate: { label: '誤拒否率', of: (m: EpisodeMetrics) => (m.benignOrders ? m.benignRejected / m.benignOrders : null), unit: '%' },
  boundaryConcentration: { label: '注文境界集中度', of: (m: EpisodeMetrics) => (m.shortSales ? m.boundaryOrders / m.shortSales : null), unit: '%' },
  pnl: { label: '仮想損益', of: (m: EpisodeMetrics) => m.pnl, unit: '円' },
} as const;
export type MetricKey = keyof typeof METRICS;

/** 実験設定のハッシュ（開始時のスナップショットの識別。設定が変われば新しい版） */
export function configHash(cfg: ExperimentConfig): string {
  const s = JSON.stringify(cfg);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const episodeSeed = (base: number, e: number) => deriveSeed(base, e);

export type ConditionEpisodes = Partial<Record<ConditionId, EpisodeMetrics[]>>;

/** 1条件・1エピソードの実行（ジョブの単位。中断・再開はこの単位で行う） */
export function runUnit(cfg: ExperimentConfig, condition: ConditionId, episode: number): EpisodeMetrics {
  return runEpisode({ condition, rules: cfg.rules, agent: cfg.agent, market: cfg.market, steps: cfg.steps, docsAccess: cfg.docsAccess }, episodeSeed(cfg.baseSeed, episode), false).metrics;
}

// ---------- 統計 ----------

export type Summary = { n: number; mean: number | null; sd: number | null; se: number | null; ci: [number, number] | null };

const T95: Record<number, number> = { 1: 12.71, 2: 4.3, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23, 15: 2.13, 20: 2.09, 30: 2.04, 60: 2.0 };
function tCrit(df: number): number {
  if (df <= 0) return NaN;
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T95[k];
  return 1.96;
}

export function summarize(xs: number[]): Summary {
  const n = xs.length;
  if (n === 0) return { n, mean: null, sd: null, se: null, ci: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: null, se: null, ci: null };
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const t = tCrit(n - 1);
  return { n, mean, sd, se, ci: [mean - t * se, mean + t * se] };
}

export type Effect = { label: string; n: number; estimate: number | null; se: number | null; ci: [number, number] | null; cohensDz: number | null };

/** エピソードごとの差（対応のある比較）の平均・SE・ブートストラップ区間・効果量 dz */
export function pairedEffect(label: string, diffs: number[], seed = 7): Effect {
  const s = summarize(diffs);
  if (s.n < 2) return { label, n: s.n, estimate: s.mean, se: null, ci: null, cohensDz: null };
  const rand = mulberry32(seed);
  const bs: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(rand() * diffs.length)];
    bs.push(sum / diffs.length);
  }
  bs.sort((a, b) => a - b);
  return { label, n: s.n, estimate: s.mean, se: s.se, ci: [bs[Math.floor(bs.length * 0.025)], bs[Math.floor(bs.length * 0.975)]], cohensDz: s.sd ? s.mean! / s.sd : null };
}

export type Analysis = {
  metric: MetricKey;
  byCondition: Partial<Record<ConditionId, Summary>>;
  /** 文言の主効果（B − A、趣旨説明の2水準で平均）、趣旨説明の主効果（あり − なし）、交互作用（(B2−B1) − (A2−A1)） */
  wording: Effect | null;
  purpose: Effect | null;
  interaction: Effect | null;
  warnings: string[];
};

export function analyze(data: ConditionEpisodes, metric: MetricKey): Analysis {
  const f = METRICS[metric].of;
  const vals = (c: ConditionId) => (data[c] ?? []).map(f);
  const byCondition: Analysis['byCondition'] = {};
  for (const c of CONDITIONS) if (data[c.id]) byCondition[c.id] = summarize(vals(c.id).filter((x): x is number => x !== null));
  const warnings: string[] = [];
  const n = Math.min(...(['A-C1', 'A-C2', 'B-C1', 'B-C2'] as ConditionId[]).map((c) => data[c]?.length ?? 0));
  let wording: Effect | null = null;
  let purpose: Effect | null = null;
  let interaction: Effect | null = null;
  if (n > 0) {
    const a1 = vals('A-C1');
    const a2 = vals('A-C2');
    const b1 = vals('B-C1');
    const b2 = vals('B-C2');
    const idx = [...Array(n).keys()].filter((i) => [a1[i], a2[i], b1[i], b2[i]].every((x) => x !== null && x !== undefined));
    wording = pairedEffect('文言の主効果（B − A）', idx.map((i) => ((b1[i]! + b2[i]!) - (a1[i]! + a2[i]!)) / 2), 11);
    purpose = pairedEffect('趣旨説明の主効果（あり − なし）', idx.map((i) => ((a2[i]! + b2[i]!) - (a1[i]! + b1[i]!)) / 2), 13);
    interaction = pairedEffect('交互作用（(B2 − B1) − (A2 − A1)）', idx.map((i) => (b2[i]! - b1[i]!) - (a2[i]! - a1[i]!)), 17);
    if (idx.length < n) warnings.push(`${n - idx.length} エピソードで指標を計算できない条件があり（分母 0）、効果の推定から除きました。`);
  }
  if (n > 0 && n < 10) warnings.push(`条件あたり ${n} エピソードと少ないため、区間が広く、結論には使えません（目安: 30 以上）。`);
  warnings.push('独立な単位はエピソードです。同じエピソード内の複数の注文は独立に扱っていません。');
  return { metric, byCondition, wording, purpose, interaction, warnings };
}
