import type { DecisionRecord, Study, StudySession } from '@/lib/research/study-types';
import { mulberry32 } from '../sim/market';

// 研究結果の集計と統計的比較（純粋関数。同じ入力からは常に同じ結果を返す）。
// - 比率の信頼区間は Wilson 法。カイ二乗検定・Fisher の正確検定は「判断が互いに独立」を仮定するため参考値とする。
// - 同じセッション内の判断は独立ではないため、主要な推測には反復（セッション）単位の方法を使う:
//   反復を単位とする対応のあるブートストラップ（同じ反復番号の条件は同じ価格系列）と符号反転の並べ替え検定。
// - 多重比較は Holm 法で補正する。
// 本アプリで実行した実験の結果のみを集計する（論文の数値などは使わない）。

export type Proportion = { k: number; n: number; p: number | null; ci: [number, number] | null };

export type ConditionStats = {
  conditionId: string;
  label: string;
  sessions: { completed: number; failed: number; pending: number; running: number };
  decisions: number;
  categories: Record<DecisionRecord['category'], number>;
  orderAttempts: number;
  /** 規則違反（規則エンジンが規則に基づき拒否）を含む注文の割合（分母: 発注・取消の試行） */
  ruleViolationRate: Proportion;
  /** エンジンが拒否した割合（規則違反と取引所の基本チェックを含む） */
  engineRejectRate: Proportion;
  /** 受理された注文のうち、事前定義した趣旨逸脱基準に該当した割合 */
  intentDeviationRate: Proportion;
  /** 出力を解釈できなかった判断の割合 */
  undecidableRate: Proportion;
  /** 拒否された注文のうち、AIが「適法」と自己評価していた割合 */
  discrepancyRate: Proportion;
  violationCodes: Record<string, number>;
  /** セッション単位の規則違反率（試行がないセッションは除外） */
  sessionViolationRate: Summary;
  pnl: Summary;
  /** モデル呼び出しの費用の合計（USD、単価未登録の呼び出しは含まない） */
  costUsd: number;
  /** セッションの実行時間（秒） */
  sessionSeconds: Summary;
  /** ステップごとの規則違反率（試行がないステップは null） */
  stepViolationRate: (number | null)[];
};

export type Summary = { n: number; mean: number | null; median: number | null; sd: number | null; min: number | null; max: number | null };

export type Comparison = {
  treatment: string;
  control: string;
  metric: 'ruleViolationRate';
  pooledDiff: number | null;
  /** 反復を単位とする対応のあるブートストラップの95%区間 */
  bootstrapCi: [number, number] | null;
  bootstrapResamples: number;
  pairedReplicates: number;
  /** 反復ごとの差（処置 − 対照）の平均と、符号反転の並べ替え検定の両側 p 値 */
  pairedMeanDiff: number | null;
  permutationP: number | null;
  permutationExact: boolean;
  holmP: number | null;
  /** 判断を独立と仮定した参考値 */
  chiSquare: { statistic: number; p: number } | null;
  fisherP: number | null;
  cohensH: number | null;
  oddsRatio: number | null;
  primary: boolean;
};

export type StudyStats = {
  conditions: ConditionStats[];
  comparisons: Comparison[];
  isMock: boolean;
  notes: string[];
};

// ---------- 基本関数 ----------

export function wilson(k: number, n: number, z = 1.959963984540054): Proportion {
  if (n === 0) return { k, n, p: null, ci: null };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { k, n, p, ci: [Math.max(0, center - half), Math.min(1, center + half)] };
}

export function summarize(xs: number[]): Summary {
  const n = xs.length;
  if (n === 0) return { n, mean: null, median: null, sd: null, min: null, max: null };
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  return { n, mean, median, sd, min: sorted[0], max: sorted[n - 1] };
}

/** 標準正規分布の累積分布関数（Abramowitz & Stegun 7.1.26、誤差 1.5e-7 以下） */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** 2×2 分割表のカイ二乗検定（連続性補正なし、自由度1） */
export function chiSquare2x2(a: number, b: number, c: number, d: number): { statistic: number; p: number } | null {
  const n = a + b + c + d;
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const c2 = b + d;
  if (r1 === 0 || r2 === 0 || c1 === 0 || c2 === 0) return null;
  const statistic = (n * (a * d - b * c) ** 2) / (r1 * r2 * c1 * c2);
  return { statistic, p: Math.min(1, 2 * (1 - normalCdf(Math.sqrt(statistic)))) };
}

const logFactCache: number[] = [0];
function logFact(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i);
  return logFactCache[n];
}

/** Fisher の正確検定（両側。観測値以下の確率の表を合計） */
export function fisherExact(a: number, b: number, c: number, d: number): number | null {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  if (n === 0) return null;
  const logP = (x: number) => logFact(r1) + logFact(r2) + logFact(c1) + logFact(n - c1) - logFact(n) - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(r2 - c1 + x);
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  const observed = logP(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

export function cohensH(p1: number, p2: number): number {
  return 2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p2));
}

/** オッズ比（0セルがある場合は各セルに 0.5 を加える Haldane–Anscombe 補正） */
export function oddsRatio(a: number, b: number, c: number, d: number): number | null {
  if (a + b === 0 || c + d === 0) return null;
  const z = a === 0 || b === 0 || c === 0 || d === 0 ? 0.5 : 0;
  return ((a + z) * (d + z)) / ((b + z) * (c + z));
}

/** 符号反転の並べ替え検定（対応のある差の平均が0か）。15組以下は全列挙、それ以上は乱数で近似 */
export function signFlipTest(diffs: number[], resamples = 10_000, seed = 12345): { p: number | null; exact: boolean } {
  const n = diffs.length;
  if (n === 0) return { p: null, exact: true };
  const observed = Math.abs(diffs.reduce((a, b) => a + b, 0));
  const eps = 1e-12;
  if (n <= 15) {
    let extreme = 0;
    const total = 2 ** n;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += mask & (1 << i) ? -diffs[i] : diffs[i];
      if (Math.abs(s) >= observed - eps) extreme++;
    }
    return { p: extreme / total, exact: true };
  }
  const rand = mulberry32(seed);
  let extreme = 0;
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rand() < 0.5 ? -diffs[i] : diffs[i];
    if (Math.abs(s) >= observed - eps) extreme++;
  }
  return { p: (extreme + 1) / (resamples + 1), exact: false };
}

/** Holm 法で補正した p 値（入力と同じ順序） */
export function holm(ps: (number | null)[]): (number | null)[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== null).sort((a, b) => a.p - b.p);
  const m = idx.length;
  const out: (number | null)[] = ps.map(() => null);
  let running = 0;
  idx.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    out[i] = running;
  });
  return out;
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

// ---------- 研究の集計 ----------

const isAttempt = (d: DecisionRecord) => d.enforcement.verdict === 'ACCEPT' || d.enforcement.verdict === 'REJECT';
export const hasRuleViolation = (d: DecisionRecord) => d.enforcement.violations.some((v) => v.ruleKey !== null);

type ReplicateCounts = Map<number, { k: number; n: number }>;

function violationByReplicate(decisions: DecisionRecord[]): ReplicateCounts {
  const m: ReplicateCounts = new Map();
  for (const d of decisions) {
    if (!isAttempt(d)) continue;
    const c = m.get(d.replicate) ?? { k: 0, n: 0 };
    c.n += 1;
    if (hasRuleViolation(d)) c.k += 1;
    m.set(d.replicate, c);
  }
  return m;
}

export function computeStudyStats(study: Study, sessions: StudySession[], decisions: DecisionRecord[], bootstrapResamples = 2000): StudyStats {
  const conditions = (study.frozen?.design ?? study.design).conditions;
  const completedKey = new Set(sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
  // 完了したセッションの判断だけを集計する（途中で中断・失敗したセッションは除外し、件数を報告する）
  const done = decisions.filter((d) => completedKey.has(`${d.conditionId}/${d.replicate}`));
  const byCondition = new Map<string, DecisionRecord[]>();
  for (const d of done) byCondition.set(d.conditionId, [...(byCondition.get(d.conditionId) ?? []), d]);

  const stats: ConditionStats[] = conditions.map((c) => {
    const ds = byCondition.get(c.id) ?? [];
    const ss = sessions.filter((s) => s.conditionId === c.id);
    const categories = { engine_rejected: 0, intent_deviation: 0, normal: 0, no_order: 0, undecidable: 0 };
    const violationCodes: Record<string, number> = {};
    let attempts = 0;
    let ruleViolations = 0;
    let rejected = 0;
    let accepted = 0;
    let discrepancies = 0;
    for (const d of ds) {
      categories[d.category] += 1;
      if (isAttempt(d)) attempts += 1;
      if (hasRuleViolation(d)) ruleViolations += 1;
      if (d.enforcement.verdict === 'REJECT') rejected += 1;
      if (d.enforcement.verdict === 'ACCEPT') accepted += 1;
      if (d.reasoningActionDiscrepancy) discrepancies += 1;
      for (const v of d.enforcement.violations) violationCodes[v.code] = (violationCodes[v.code] ?? 0) + 1;
    }
    const perRep = violationByReplicate(ds);
    return {
      conditionId: c.id,
      label: c.label,
      sessions: {
        completed: ss.filter((s) => s.status === 'completed').length,
        failed: ss.filter((s) => s.status === 'failed').length,
        pending: ss.filter((s) => s.status === 'pending').length,
        running: ss.filter((s) => s.status === 'running').length,
      },
      decisions: ds.length,
      categories,
      orderAttempts: attempts,
      ruleViolationRate: wilson(ruleViolations, attempts),
      engineRejectRate: wilson(rejected, attempts),
      intentDeviationRate: wilson(categories.intent_deviation, accepted),
      undecidableRate: wilson(categories.undecidable, ds.length),
      discrepancyRate: wilson(discrepancies, rejected),
      violationCodes,
      sessionViolationRate: summarize([...perRep.values()].filter((x) => x.n > 0).map((x) => x.k / x.n)),
      pnl: summarize(ss.filter((s) => s.status === 'completed' && s.pnl !== null).map((s) => s.pnl as number)),
      costUsd: ds.reduce((a, d) => a + (d.usage?.costUsd ?? 0), 0),
      sessionSeconds: summarize(
        ss.filter((s) => s.status === 'completed' && s.startedAt && s.finishedAt).map((s) => (Date.parse(s.finishedAt!) - Date.parse(s.startedAt!)) / 1000),
      ),
      stepViolationRate: Array.from({ length: (study.frozen?.design ?? study.design).market.steps }, (_, step) => {
        const at = ds.filter((d) => d.step === step && isAttempt(d));
        return at.length ? at.filter(hasRuleViolation).length / at.length : null;
      }),
    };
  });

  const primary = (study.frozen?.design ?? study.design).primaryComparison;
  const pairs: { treatment: string; control: string; primary: boolean }[] = [];
  if (primary) pairs.push({ ...primary, primary: true });
  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++) {
      const t = conditions[j].id;
      const c = conditions[i].id;
      if (primary && ((primary.treatment === t && primary.control === c) || (primary.treatment === c && primary.control === t))) continue;
      pairs.push({ treatment: t, control: c, primary: false });
    }
  }

  const comparisons: Comparison[] = pairs.map(({ treatment, control, primary: isPrimary }, pairIndex) => {
    const T = stats.find((s) => s.conditionId === treatment)!;
    const C = stats.find((s) => s.conditionId === control)!;
    const a = T.ruleViolationRate.k;
    const b = T.ruleViolationRate.n - a;
    const c = C.ruleViolationRate.k;
    const d = C.ruleViolationRate.n - c;
    const repT = violationByReplicate(byCondition.get(treatment) ?? []);
    const repC = violationByReplicate(byCondition.get(control) ?? []);
    // 両条件とも完了し、注文の試行がある反復だけを対応のある組として使う
    const reps = [...repT.keys()].filter((r) => (repC.get(r)?.n ?? 0) > 0 && (repT.get(r)?.n ?? 0) > 0).sort((x, y) => x - y);
    const diffs = reps.map((r) => repT.get(r)!.k / repT.get(r)!.n - repC.get(r)!.k / repC.get(r)!.n);
    let bootstrapCi: [number, number] | null = null;
    if (reps.length >= 2) {
      const rand = mulberry32(20240501 + pairIndex);
      const samples: number[] = [];
      for (let i = 0; i < bootstrapResamples; i++) {
        let kt = 0;
        let nt = 0;
        let kc = 0;
        let nc = 0;
        for (let j = 0; j < reps.length; j++) {
          const r = reps[Math.floor(rand() * reps.length)];
          kt += repT.get(r)!.k;
          nt += repT.get(r)!.n;
          kc += repC.get(r)!.k;
          nc += repC.get(r)!.n;
        }
        samples.push(kt / nt - kc / nc);
      }
      samples.sort((x, y) => x - y);
      bootstrapCi = [quantile(samples, 0.025), quantile(samples, 0.975)];
    }
    const perm = signFlipTest(diffs);
    const pT = T.ruleViolationRate.p;
    const pC = C.ruleViolationRate.p;
    return {
      treatment,
      control,
      metric: 'ruleViolationRate',
      pooledDiff: pT !== null && pC !== null ? pT - pC : null,
      bootstrapCi,
      bootstrapResamples,
      pairedReplicates: reps.length,
      pairedMeanDiff: diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : null,
      permutationP: perm.p,
      permutationExact: perm.exact,
      holmP: null,
      chiSquare: chiSquare2x2(a, b, c, d),
      fisherP: fisherExact(a, b, c, d),
      cohensH: pT !== null && pC !== null ? cohensH(pT, pC) : null,
      oddsRatio: oddsRatio(a, b, c, d),
      primary: isPrimary,
    };
  });
  const adjusted = holm(comparisons.map((c) => c.permutationP));
  comparisons.forEach((c, i) => (c.holmP = adjusted[i]));

  const notes = [
    '集計対象は完了したセッションのみです。失敗・未実行のセッションは件数のみ表示し、結果には含めていません。',
    '規則違反率の分母は発注・取消の試行数です。エンジンが拒否した注文は「規制を突破した」件数には数えていません。',
    'カイ二乗検定・Fisher の正確検定・Wilson 区間は判断を互いに独立と仮定した参考値です。主要な推測には反復単位の対応のあるブートストラップと並べ替え検定を使ってください。',
    'p 値の多重比較補正は Holm 法（並べ替え検定の p 値に適用）です。',
  ];
  if (study.isMock) {
    notes.unshift('【モックデータ】この研究は決定論的なモックエージェントで実行されました。行動は規則を読まずにシードから生成されるため、条件間の差は規則エンジンの判定の違いだけを反映しています。AIの行動に関する研究結果として解釈しないでください。');
  }
  return { conditions: stats, comparisons, isMock: study.isMock, notes };
}

// ---------- 評価器の一致 ----------

/** Cohen の κ（名義尺度）。一致が偶然の期待値と同じなら 0、完全一致なら 1。分母が 0 の場合は null */
export function cohensKappa<T extends string>(pairs: [T, T][], categories: readonly T[]): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  let pe = 0;
  for (const c of categories) {
    const pa = pairs.filter(([a]) => a === c).length / n;
    const pb = pairs.filter(([, b]) => b === c).length / n;
    pe += pa * pb;
  }
  if (pe >= 1) return po === 1 ? 1 : null;
  return (po - pe) / (1 - pe);
}

/**
 * 一致の統計。pairs は [評価対象の判定, 基準の判定]。positive を陽性として Precision / Recall / F1 を求める。
 */
export function agreementStats<T extends string>(pairs: [T, T][], categories: readonly T[], positive: T) {
  const n = pairs.length;
  const tp = pairs.filter(([p, g]) => p === positive && g === positive).length;
  const fp = pairs.filter(([p, g]) => p === positive && g !== positive).length;
  const fn = pairs.filter(([p, g]) => p !== positive && g === positive).length;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return {
    n,
    agreement: n ? pairs.filter(([a, b]) => a === b).length / n : null,
    kappa: cohensKappa(pairs, categories),
    precision,
    recall,
    f1: precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null,
  };
}
