import type { DecisionRecord, Study, StudyCondition } from '@/lib/research/study-types';
import { normalCdf } from './stats';

// 条件の要因（文言・趣旨の提示・目標など）を説明変数とするロジスティック回帰。
// - 目的変数: 発注・取消の試行が規則違反を含むか（判断単位）。
// - 推定: 反復重み付き最小二乗法（IRLS）。標準誤差はセッション（条件 × 反復）単位のクラスター頑健（サンドイッチ）推定。
// - 要因は条件間で値が2通りに分かれるものだけを使う（対照群の値を基準 0）。2要因が全組み合わせで観測される場合は交互作用も推定する。

export type FactorKey = 'rules' | 'presentRules' | 'includePurpose' | 'objective' | 'persona';

export const FACTOR_LABELS: Record<FactorKey, string> = {
  rules: '規則の文言（版）',
  presentRules: '条文の提示',
  includePurpose: '趣旨の提示',
  objective: 'エージェントの目標',
  persona: 'ペルソナ',
};

const factorValue = (c: StudyCondition, f: FactorKey): string => {
  if (f === 'rules') return [...c.ruleVersionIds].sort().join('+') || '(なし)';
  return String(c[f]);
};

export type Term = { name: string; label: string; factors: FactorKey[] };

export type Coefficient = {
  term: string;
  label: string;
  estimate: number;
  se: number;
  z: number;
  p: number;
  oddsRatio: number;
  ci: [number, number];
};

export type LogisticResult =
  | {
      ok: true;
      n: number;
      clusters: number;
      events: number;
      iterations: number;
      terms: Term[];
      coefficients: Coefficient[];
      baseline: string;
      levels: { factor: FactorKey; label: string; baseline: string; treatment: string; conditions: Record<string, 0 | 1> }[];
      skippedFactors: { factor: FactorKey; label: string; reason: string }[];
      notes: string[];
    }
  | { ok: false; reason: string; skippedFactors?: { factor: FactorKey; label: string; reason: string }[] };

/** 小さな正方行列の逆行列（ガウス・ジョルダン法）。特異なら null */
export function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-10) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const div = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * ロジスティック回帰（IRLS）とクラスター頑健な標準誤差。
 * X は切片を含む計画行列、cluster は観測ごとのクラスター ID。
 */
export function fitLogistic(X: number[][], y: number[], cluster: string[], maxIter = 50) {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  let beta = Array(p).fill(0);
  let converged = false;
  let iter = 0;
  let info: number[][] | null = null;
  for (; iter < maxIter; iter++) {
    const H = Array.from({ length: p }, () => Array(p).fill(0));
    const g = Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const eta = X[i].reduce((s, x, j) => s + x * beta[j], 0);
      const mu = 1 / (1 + Math.exp(-eta));
      const w = Math.max(mu * (1 - mu), 1e-12);
      for (let j = 0; j < p; j++) {
        g[j] += X[i][j] * (y[i] - mu);
        for (let k = 0; k < p; k++) H[j][k] += w * X[i][j] * X[i][k];
      }
    }
    info = invert(H);
    if (!info) return { ok: false as const, reason: '計画行列が特異です（要因が互いに区別できないか、ある要因の水準が観測されていません）。' };
    const step = info.map((row) => row.reduce((s, v, k) => s + v * g[k], 0));
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) {
      converged = true;
      iter += 1;
      break;
    }
  }
  if (!converged || beta.some((b) => !Number.isFinite(b) || Math.abs(b) > 15)) {
    return { ok: false as const, reason: '推定が収束しませんでした（ある条件で違反が 0 件またはすべてなど、完全分離の可能性があります）。' };
  }
  // クラスター頑健な分散: (X'WX)^-1 (Σ_g s_g s_g') (X'WX)^-1 × G/(G-1)
  const scores = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const eta = X[i].reduce((s, x, j) => s + x * beta[j], 0);
    const mu = 1 / (1 + Math.exp(-eta));
    const s = scores.get(cluster[i]) ?? Array(p).fill(0);
    for (let j = 0; j < p; j++) s[j] += X[i][j] * (y[i] - mu);
    scores.set(cluster[i], s);
  }
  const G = scores.size;
  const meat = Array.from({ length: p }, () => Array(p).fill(0));
  for (const s of scores.values()) for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) meat[j][k] += s[j] * s[k];
  const bread = info!;
  const mult = (A: number[][], B: number[][]) => A.map((row) => B[0].map((_, k) => row.reduce((acc, v, j) => acc + v * B[j][k], 0)));
  const V = mult(mult(bread, meat), bread).map((row) => row.map((v) => (G > 1 ? (v * G) / (G - 1) : v)));
  return { ok: true as const, beta, se: V.map((row, j) => Math.sqrt(Math.max(row[j], 0))), iterations: iter, clusters: G };
}

const isAttempt = (d: DecisionRecord) => d.enforcement.verdict === 'ACCEPT' || d.enforcement.verdict === 'REJECT';
const isViolation = (d: DecisionRecord) => d.enforcement.violations.some((v) => v.ruleKey !== null);

/** 研究の条件設計から要因を取り出し、規則違反の試行についてロジスティック回帰を行う */
export function conditionLogistic(study: Study, decisions: DecisionRecord[], completedSessions: Set<string>): LogisticResult {
  const design = study.frozen?.design ?? study.design;
  // 規則のない条件（統制群）では違反が起こり得ないため、違反の有無を目的変数とする回帰からは除く
  const conds = design.conditions.filter((c) => c.ruleVersionIds.length > 0);
  const excluded = design.conditions.filter((c) => c.ruleVersionIds.length === 0).map((c) => c.label);
  if (conds.length < 2) return { ok: false, reason: '規則のある条件が1つ以下のため、要因の効果を推定できません。' };
  const base = conds.find((c) => c.id === design.primaryComparison?.control) ?? conds[0];
  const skipped: { factor: FactorKey; label: string; reason: string }[] = [];
  const levels: Extract<LogisticResult, { ok: true }>['levels'] = [];
  for (const f of Object.keys(FACTOR_LABELS) as FactorKey[]) {
    const values = [...new Set(conds.map((c) => factorValue(c, f)))];
    if (values.length === 1) continue;
    if (values.length > 2) {
      skipped.push({ factor: f, label: FACTOR_LABELS[f], reason: `水準が${values.length}つあるため、この版では2水準の要因だけを推定します。` });
      continue;
    }
    const b = factorValue(base, f);
    const t = values.find((v) => v !== b)!;
    levels.push({ factor: f, label: FACTOR_LABELS[f], baseline: b, treatment: t, conditions: Object.fromEntries(conds.map((c) => [c.id, factorValue(c, f) === b ? 0 : 1])) as Record<string, 0 | 1> });
  }
  if (levels.length === 0) return { ok: false, reason: '条件間で値が2通りに分かれる要因がありません。', skippedFactors: skipped };
  const terms: Term[] = levels.map((l) => ({ name: l.factor, label: l.label, factors: [l.factor] }));
  for (let i = 0; i < levels.length; i++) {
    for (let k = i + 1; k < levels.length; k++) {
      const combos = new Set(conds.map((c) => `${levels[i].conditions[c.id]}${levels[k].conditions[c.id]}`));
      if (combos.size === 4) terms.push({ name: `${levels[i].factor}:${levels[k].factor}`, label: `${levels[i].label} × ${levels[k].label}（交互作用）`, factors: [levels[i].factor, levels[k].factor] });
    }
  }
  const X: number[][] = [];
  const y: number[] = [];
  const cluster: string[] = [];
  const included = new Set(conds.map((c) => c.id));
  for (const d of decisions) {
    if (!included.has(d.conditionId) || !completedSessions.has(`${d.conditionId}/${d.replicate}`) || !isAttempt(d)) continue;
    const row = [1, ...terms.map((t) => t.factors.reduce((acc, f) => acc * levels.find((l) => l.factor === f)!.conditions[d.conditionId], 1))];
    X.push(row);
    y.push(isViolation(d) ? 1 : 0);
    cluster.push(`${d.conditionId}/${d.replicate}`);
  }
  if (X.length < 10) return { ok: false, reason: '発注・取消の試行が少なすぎます（10件未満）。', skippedFactors: skipped };
  const fit = fitLogistic(X, y, cluster);
  if (!fit.ok) return { ok: false, reason: fit.reason, skippedFactors: skipped };
  const names = [{ name: '(Intercept)', label: '切片（対照群の水準）' }, ...terms.map((t) => ({ name: t.name, label: t.label }))];
  const coefficients: Coefficient[] = names.map((t, j) => {
    const est = fit.beta[j];
    const se = fit.se[j];
    const z = se > 0 ? est / se : 0;
    return { term: t.name, label: t.label, estimate: est, se, z, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))), oddsRatio: Math.exp(est), ci: [Math.exp(est - 1.959964 * se), Math.exp(est + 1.959964 * se)] };
  });
  const notes = [
    '係数は対数オッズ比、オッズ比の95%区間はセッション単位のクラスター頑健標準誤差によるWald区間です。',
    '条件は研究者が割り当て、同じ反復番号では全条件で同じ外生価格系列を使っています。ただし LLM の応答は確率的で、同じシードでも行動は一致しません。',
  ];
  if (excluded.length) notes.push(`規則のない条件（${excluded.join('、')}）は違反が起こり得ないため、回帰から除いています。`);
  if (fit.clusters < 30) notes.push(`クラスター（セッション）数が${fit.clusters}と少ないため、標準誤差が過小になる可能性があります。`);
  if (study.isMock) notes.unshift('【モックデータ】行動は規則を読まずに生成されているため、推定される効果は規則エンジンの判定の違いだけを反映します。');
  return { ok: true, n: X.length, clusters: fit.clusters, events: y.reduce((a, b) => a + b, 0), iterations: fit.iterations, terms, coefficients, baseline: base.label, levels, skippedFactors: skipped, notes };
}
