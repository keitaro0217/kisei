import {
  EVAL_CATEGORIES,
  POSITIVE_CATEGORIES,
  type BiasCheck,
  type ClassMetrics,
  type CompositeEvaluation,
  type EvalCategory,
  type EvaluationRecord,
  type EvaluatorRef,
  type GoldLabel,
  type RateCi,
  type ValidationMetrics,
} from '@/lib/research/evaluation-model';
import { mulberry32 } from '../sim/market';
import { cohensKappa, wilson } from '../study/stats';
import { AGGREGATION_VERSION } from './unified';

// 評価器の妥当性の検証。外部ラベル（正解）に対する指標を計算する。
// - 正解ラベルがない評価器・データでは指標を計算せず、status = not_measured とする（推測で表示しない）。
// - 少数のサンプル・クラスの不均衡は警告として返す。比率には 95% Wilson 区間、κ にはブートストラップ区間を付ける。
// - 評価器の自己申告の不確実性（自信）と、正解率は別々に示す。

export type Prediction = { category: EvalCategory; uncertainty: 'low' | 'medium' | 'high' | null };

const rate = (k: number, n: number): RateCi => {
  const w = wilson(k, n);
  return { k, n, p: w.p, ci: w.ci };
};
const f1Of = (p: number | null, r: number | null) => (p !== null && r !== null && p + r > 0 ? (2 * p * r) / (p + r) : p === 0 && r === 0 ? 0 : null);

/**
 * 正解（評価者が複数なら一致したもの）。評価者の間で割れた判断は「正解が決まらない」として除外する（多数決で決めない）。
 */
export function goldConsensus(labels: GoldLabel[]): { gold: Map<string, EvalCategory>; disputed: Set<string>; formal: Map<string, 'compliant' | 'violation'> } {
  const byItem = new Map<string, GoldLabel[]>();
  for (const l of labels) byItem.set(l.itemKey, [...(byItem.get(l.itemKey) ?? []), l]);
  const gold = new Map<string, EvalCategory>();
  const formal = new Map<string, 'compliant' | 'violation'>();
  const disputed = new Set<string>();
  for (const [k, ls] of byItem) {
    const cats = new Set(ls.map((l) => l.category));
    if (cats.size === 1) gold.set(k, ls[0].category);
    else disputed.add(k);
    const fs = new Set(ls.map((l) => l.formal).filter((f): f is 'compliant' | 'violation' => f !== null));
    if (fs.size === 1) formal.set(k, [...fs][0]);
  }
  return { gold, disputed, formal };
}

export function computeMetrics(evaluator: EvaluatorRef, predictions: Map<string, Prediction>, gold: Map<string, EvalCategory>, disputed = 0, seed = 20261104): ValidationMetrics {
  const pairs: { pred: EvalCategory; gold: EvalCategory; uncertainty: Prediction['uncertainty'] }[] = [];
  let missing = 0;
  for (const [k, g] of gold) {
    const p = predictions.get(k);
    if (!p) {
      missing++;
      continue;
    }
    pairs.push({ pred: p.category, gold: g, uncertainty: p.uncertainty });
  }
  const n = pairs.length;
  const categories = EVAL_CATEGORIES.filter((c) => pairs.some((x) => x.gold === c || x.pred === c));
  const confusion: Record<string, Record<string, number>> = {};
  for (const g of categories) {
    confusion[g] = {};
    for (const p of categories) confusion[g][p] = 0;
  }
  for (const x of pairs) confusion[x.gold][x.pred] += 1;
  const empty: ValidationMetrics = {
    status: 'not_measured',
    evaluator,
    n: 0,
    missingPredictions: missing,
    disputedGold: disputed,
    categories: [],
    confusion: {},
    accuracy: rate(0, 0),
    perClass: [],
    macroF1: null,
    weightedF1: null,
    kappa: null,
    kappaCi: null,
    binary: { tp: 0, fp: 0, fn: 0, tn: 0, precision: rate(0, 0), recall: rate(0, 0), fpr: rate(0, 0), fnr: rate(0, 0), f1: null },
    byUncertainty: [],
    warnings: ['正解ラベルと比較できる判定がないため、指標は未測定です。'],
  };
  if (n === 0) return empty;

  const perClass: ClassMetrics[] = categories.map((c) => {
    const tp = pairs.filter((x) => x.pred === c && x.gold === c).length;
    const predicted = pairs.filter((x) => x.pred === c).length;
    const support = pairs.filter((x) => x.gold === c).length;
    const precision = rate(tp, predicted);
    const recall = rate(tp, support);
    return { category: c, support, predicted, precision, recall, f1: f1Of(precision.p, recall.p) };
  });
  // F1 は正解側に出現するクラスだけで平均する（予測にだけ出るクラスは support 0 で重み 0）
  const supported = perClass.filter((c) => c.support > 0);
  const f1s = supported.map((c) => c.f1 ?? 0);
  const macroF1 = supported.length ? f1s.reduce((a, b) => a + b, 0) / supported.length : null;
  const weightedF1 = n ? supported.reduce((a, c) => a + (c.f1 ?? 0) * c.support, 0) / n : null;
  const kpairs = pairs.map((x) => [x.pred, x.gold] as [EvalCategory, EvalCategory]);
  const kappa = cohensKappa(kpairs, categories);
  // κ のブートストラップ区間（判断を単位に再標本化。シード固定で再現可能）
  let kappaCi: [number, number] | null = null;
  if (n >= 10 && kappa !== null) {
    const rand = mulberry32(seed);
    const ks: number[] = [];
    for (let b = 0; b < 1000; b++) {
      const sample: [EvalCategory, EvalCategory][] = [];
      for (let i = 0; i < n; i++) sample.push(kpairs[Math.floor(rand() * n)]);
      const k = cohensKappa(sample, categories);
      if (k !== null && Number.isFinite(k)) ks.push(k);
    }
    ks.sort((a, b) => a - b);
    if (ks.length >= 100) kappaCi = [ks[Math.floor(ks.length * 0.025)], ks[Math.min(ks.length - 1, Math.floor(ks.length * 0.975))]];
  }
  const pos = (c: EvalCategory) => POSITIVE_CATEGORIES.includes(c);
  const tp = pairs.filter((x) => pos(x.pred) && pos(x.gold)).length;
  const fp = pairs.filter((x) => pos(x.pred) && !pos(x.gold)).length;
  const fn = pairs.filter((x) => !pos(x.pred) && pos(x.gold)).length;
  const tn = n - tp - fp - fn;
  const bp = rate(tp, tp + fp);
  const br = rate(tp, tp + fn);
  const byUncertainty = (['low', 'medium', 'high', 'none'] as const)
    .map((u) => {
      const xs = pairs.filter((x) => (x.uncertainty ?? 'none') === u);
      return { uncertainty: u, accuracy: rate(xs.filter((x) => x.pred === x.gold).length, xs.length) };
    })
    .filter((x) => x.accuracy.n > 0);

  const warnings: string[] = [];
  if (n < 30) warnings.push(`比較できた件数が ${n} 件と少ないため、指標の区間が広く、結論には使えません（目安: 30件以上、クラスごとに10件以上）。`);
  for (const c of supported) if (c.support < 5) warnings.push(`「${c.category}」の正解ラベルが ${c.support} 件しかありません。このクラスの適合率・再現率は不安定です。`);
  const maxS = Math.max(...supported.map((c) => c.support));
  const minS = Math.min(...supported.map((c) => c.support));
  if (supported.length > 1 && maxS / Math.max(1, minS) >= 10) warnings.push('クラスの件数に大きな偏りがあります。正解率（accuracy）より、マクロ F1・クラス別の再現率を見てください。');
  if (missing > 0) warnings.push(`正解ラベルのある判断のうち ${missing} 件をこの評価器は評価していません（標本の違いに注意）。`);
  if (disputed > 0) warnings.push(`正解ラベルの評価者の間で判断が割れた ${disputed} 件は、比較から除外しました。`);

  return {
    status: 'measured',
    evaluator,
    n,
    missingPredictions: missing,
    disputedGold: disputed,
    categories,
    confusion,
    accuracy: rate(pairs.filter((x) => x.pred === x.gold).length, n),
    perClass,
    macroF1,
    weightedF1,
    kappa,
    kappaCi,
    binary: { tp, fp, fn, tn, precision: bp, recall: br, fpr: rate(fp, fp + tn), fnr: rate(fn, fn + tp), f1: f1Of(bp.p, br.p) },
    byUncertainty,
    warnings,
  };
}

/** 評価器ごとの判定（レビューで却下されたものは除き、修正されたものは修正後） */
export function predictionsByEvaluator(records: EvaluationRecord[]): Map<string, { ref: EvaluatorRef; preds: Map<string, Prediction> }> {
  const out = new Map<string, { ref: EvaluatorRef; preds: Map<string, Prediction> }>();
  for (const r of records) {
    if (r.review.state === 'rejected') continue;
    const cat = r.review.state === 'corrected' && r.review.correctedCategory ? r.review.correctedCategory : r.category;
    const e = out.get(r.evaluator.id) ?? { ref: r.evaluator, preds: new Map() };
    e.preds.set(r.target.itemKey, { category: cat, uncertainty: r.uncertainty });
    out.set(r.evaluator.id, e);
  }
  return out;
}

export const compositeEvaluatorRef = (): EvaluatorRef => ({ kind: 'composite', id: `composite:${AGGREGATION_VERSION}`, name: '複合評価', version: AGGREGATION_VERSION, model: null, providerType: null, independentOfGenerator: null });

/** 形式の軸だけの指標（正解ラベルに形式の判定がある場合） */
export function formalAxisMetrics(evaluator: EvaluatorRef, records: EvaluationRecord[], goldFormal: Map<string, 'compliant' | 'violation'>): ValidationMetrics {
  const preds = new Map<string, Prediction>();
  for (const r of records) if (r.formal === 'compliant' || r.formal === 'violation') preds.set(r.target.itemKey, { category: r.formal === 'violation' ? 'explicit_violation' : 'compliant', uncertainty: null });
  const gold = new Map([...goldFormal].map(([k, v]) => [k, v === 'violation' ? ('explicit_violation' as const) : ('compliant' as const)]));
  return computeMetrics({ ...evaluator, name: `${evaluator.name}（形式の軸）` }, preds, gold);
}

/** 評価者（ラベル付けした人）どうしの一致 */
export function annotatorAgreement(labels: GoldLabel[]): { a: string; b: string; n: number; agreement: number | null; kappa: number | null }[] {
  const annotators = [...new Set(labels.map((l) => l.annotator))].sort();
  const byA = new Map(annotators.map((a) => [a, new Map(labels.filter((l) => l.annotator === a).map((l) => [l.itemKey, l.category]))]));
  const out = [];
  for (let i = 0; i < annotators.length; i++)
    for (let j = i + 1; j < annotators.length; j++) {
      const A = byA.get(annotators[i])!;
      const B = byA.get(annotators[j])!;
      const pairs: [EvalCategory, EvalCategory][] = [];
      for (const [k, c] of A) if (B.has(k)) pairs.push([c, B.get(k)!]);
      out.push({ a: annotators[i], b: annotators[j], n: pairs.length, agreement: pairs.length ? pairs.filter(([x, y]) => x === y).length / pairs.length : null, kappa: cohensKappa(pairs, EVAL_CATEGORIES) });
    }
  return out;
}

/** カテゴリごとの曖昧さ: そのカテゴリを選んだ評価者がいる判断のうち、評価者全員が一致しなかった割合 */
export function categoryAmbiguity(labels: GoldLabel[]): { category: EvalCategory; items: number; disagreementRate: number | null }[] {
  const byItem = new Map<string, GoldLabel[]>();
  for (const l of labels) byItem.set(l.itemKey, [...(byItem.get(l.itemKey) ?? []), l]);
  const multi = [...byItem.values()].filter((ls) => new Set(ls.map((l) => l.annotator)).size > 1);
  return EVAL_CATEGORIES.map((c) => {
    const involved = multi.filter((ls) => ls.some((l) => l.category === c));
    const split = involved.filter((ls) => new Set(ls.map((l) => l.category)).size > 1).length;
    return { category: c, items: involved.length, disagreementRate: involved.length ? split / involved.length : null };
  }).filter((x) => x.items > 0);
}

/**
 * 評価のバイアスの検証。同じ判断を評価した Judge の組を、違い（モデル・プロンプトの版・証拠の順序・同一設定）で分類し、一致度を比べる。
 * 正解ラベルがあれば、それぞれの正解率も示す（ない場合は null = 未測定）。
 */
export function biasChecks(records: EvaluationRecord[], gold: Map<string, EvalCategory>, labels: GoldLabel[]): BiasCheck[] {
  const judges = [...predictionsByEvaluator(records.filter((r) => r.evaluator.kind === 'llm_judge')).values()];
  const out: BiasCheck[] = [];
  const acc = (preds: Map<string, Prediction>): RateCi | null => {
    let k = 0;
    let n = 0;
    for (const [key, g] of gold) {
      const p = preds.get(key);
      if (!p) continue;
      n++;
      if (p.category === g) k++;
    }
    return n ? rate(k, n) : null;
  };
  // 自己評価: 行動を生成したモデルと同じモデルの Judge と、別のモデルの Judge
  const self = judges.filter((j) => j.ref.independentOfGenerator === false);
  const indep = judges.filter((j) => j.ref.independentOfGenerator === true);
  for (const s of self)
    for (const i of indep) out.push(pairCheck('self_evaluation', '自己評価（生成と同じモデル）と独立した評価の比較', s, i, acc));
  for (let a = 0; a < judges.length; a++)
    for (let b = a + 1; b < judges.length; b++) {
      const A = judges[a].ref;
      const B = judges[b].ref;
      const [pa, ha, oa] = A.version.split(/[#:]/);
      const [pb, hb, ob] = B.version.split(/[#:]/);
      const sameModel = A.model === B.model;
      const samePrompt = pa === pb && ha === hb;
      const sameOrder = (oa ?? '') === (ob ?? '');
      let kind: BiasCheck['kind'] | null = null;
      if (!sameModel && samePrompt && sameOrder) kind = 'evaluator_model';
      else if (sameModel && !samePrompt && sameOrder) kind = 'prompt_version';
      else if (sameModel && samePrompt && !sameOrder) kind = 'evidence_order';
      else if (sameModel && samePrompt && sameOrder) kind = 'repeatability';
      if (!kind) continue;
      const titles: Record<string, string> = {
        evaluator_model: '評価モデルの違い（プロンプト・順序は同じ）',
        prompt_version: 'プロンプトの版の違い（モデル・順序は同じ）',
        evidence_order: '証拠の提示順序の影響（モデル・プロンプトは同じ）',
        repeatability: '同じ設定での再評価の一致（再現性）',
      };
      out.push(pairCheck(kind, titles[kind], judges[a], judges[b], acc));
    }
  for (const x of annotatorAgreement(labels)) {
    out.push({ kind: 'annotator_disagreement', title: '正解ラベルの評価者どうしの一致', a: x.a, b: x.b, n: x.n, agreement: x.agreement, kappa: x.kappa, accuracyA: null, accuracyB: null, note: '評価者の間の不一致は、カテゴリの定義の曖昧さや専門家の判断の違いを示します。' });
  }
  for (const c of categoryAmbiguity(labels)) {
    out.push({
      kind: 'category_ambiguity',
      title: `カテゴリの曖昧さ: ${c.category}`,
      a: c.category,
      b: '他のカテゴリ',
      n: c.items,
      agreement: c.disagreementRate === null ? null : 1 - c.disagreementRate,
      kappa: null,
      accuracyA: null,
      accuracyB: null,
      note: 'このカテゴリを選んだ評価者がいる判断のうち、評価者全員が一致した割合です。低いほど定義が曖昧な可能性があります。',
    });
  }
  return out;
}

function pairCheck(kind: BiasCheck['kind'], title: string, A: { ref: EvaluatorRef; preds: Map<string, Prediction> }, B: { ref: EvaluatorRef; preds: Map<string, Prediction> }, acc: (p: Map<string, Prediction>) => RateCi | null): BiasCheck {
  const pairs: [EvalCategory, EvalCategory][] = [];
  for (const [k, p] of A.preds) {
    const q = B.preds.get(k);
    if (q) pairs.push([p.category, q.category]);
  }
  return {
    kind,
    title,
    a: `${A.ref.name}（${A.ref.model ?? '—'}）`,
    b: `${B.ref.name}（${B.ref.model ?? '—'}）`,
    n: pairs.length,
    agreement: pairs.length ? pairs.filter(([x, y]) => x === y).length / pairs.length : null,
    kappa: cohensKappa(pairs, EVAL_CATEGORIES),
    accuracyA: acc(A.preds),
    accuracyB: acc(B.preds),
    note: pairs.length < 30 ? '比較できた件数が少ないため、差があっても偶然の可能性があります。' : '一致度が低いほど、評価がこの要因に影響されている可能性があります（どちらが正しいかは正解ラベルとの比較で判断します）。',
  };
}

export const compositePredictions = (cs: CompositeEvaluation[]): Map<string, Prediction> => new Map(cs.map((c) => [c.target.itemKey, { category: c.category, uncertainty: null }]));
