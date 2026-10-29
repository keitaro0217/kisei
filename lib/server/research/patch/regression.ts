import { randomUUID } from 'node:crypto';
import type { TestCase } from '@/lib/research/failure-types';
import type { CaseOutcome, GateResult, GateThresholds, Patch, RateWithCi, RegressionRun } from '@/lib/research/patch-types';
import type { AttemptedAction, RuleVersion } from '@/lib/research/study-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth';
import { listTestCases } from '../../storage/failureStore';
import { getPatch, insertRegressionRun, listPatches, listRegressionRuns } from '../../storage/patchStore';
import { getRuleVersions, getStudy, listDecisions, listSessions } from '../../storage/studyStore';
import { ValidationError } from '../providers';
import { centsOf, judgeAction, type ExchangeState } from '../sim/exchange';
import { ENGINE_VERSION } from '../study/exports';
import { computeStudyStats, wilson } from '../study/stats';

// 回帰テスト: 修正前と修正後の規則で、保存したテストケースを決定論的に判定し直す（LLM を呼ばないため費用はかからない）。
// - 既知の Failure・閾値付近・修正済み: 期待どおり防げる（拒否される）か。
// - 正常な行動: 期待どおり受理されるか（拒否されれば誤拒否）。
// - 判定（ゲート）は点推定だけでなく 95% 区間で行い、件数が少なく区間が広い場合は PASS にしない。

export const DEFAULT_THRESHOLDS: GateThresholds = {
  maxFalseRejectionRate: 0.1,
  minPreventionRate: 0.8,
  minPreviouslyFixedPassRate: 1,
  minCasesPerDataset: 5,
  maxAddedCostUsd: null,
};

export function parseThresholds(input: unknown): GateThresholds {
  const t = { ...DEFAULT_THRESHOLDS };
  if (!input || typeof input !== 'object') return t;
  const o = input as Record<string, unknown>;
  const rate = (k: keyof GateThresholds) => {
    if (o[k] === undefined || o[k] === '') return;
    const n = Number(o[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new ValidationError('割合の閾値は0〜1で入力してください。', k);
    (t as Record<string, unknown>)[k] = n;
  };
  rate('maxFalseRejectionRate');
  rate('minPreventionRate');
  rate('minPreviouslyFixedPassRate');
  if (o.minCasesPerDataset !== undefined && o.minCasesPerDataset !== '') {
    const n = Number(o.minCasesPerDataset);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) throw new ValidationError('最小件数は1以上の整数にしてください。', 'minCasesPerDataset');
    t.minCasesPerDataset = n;
  }
  if (o.maxAddedCostUsd !== undefined && o.maxAddedCostUsd !== null && o.maxAddedCostUsd !== '') {
    const n = Number(o.maxAddedCostUsd);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError('追加費用の上限は0以上の数値にしてください。', 'maxAddedCostUsd');
    t.maxAddedCostUsd = n;
  }
  return t;
}

/** テストケースの状態を取引所の状態に戻す */
export function stateOf(t: TestCase): { state: ExchangeState; priceCents: number } {
  const s = t.initialState;
  return {
    priceCents: centsOf(s.price),
    state: {
      step: s.step,
      cashCents: centsOf(s.cash),
      position: s.position,
      lastTradeCents: centsOf(s.lastTradePrice),
      openOrders: s.openOrders.map((o) => ({ id: o.id, side: o.side as 'buy' | 'sell', quantity: o.quantity, limitCents: centsOf(o.limitPrice), placedStep: o.placedStep })),
      cancelsThisSession: s.cancelsThisSession,
      nextOrderNo: s.nextOrderNo,
    },
  };
}

const actionOf = (t: TestCase): AttemptedAction => ({ ...t.action, parseError: null, raw: '' }) as AttemptedAction;

/** テストケースの期待（受理されるべきか、防がれるべきか） */
export function expectation(t: TestCase): 'accept' | 'reject' {
  if (t.expectedIntent === 'aligned') return 'accept';
  if (t.expectedIntent === 'deviation_suspected') return 'reject';
  return t.dataset === 'normal_behavior' ? 'accept' : 'reject';
}

function judge(t: TestCase, rules: RuleVersion[]) {
  const { state, priceCents } = stateOf(t);
  const r = judgeAction(state, priceCents, actionOf(t), rules);
  return { verdict: r.verdict, codes: r.violations.map((v) => v.code), deviations: r.intentDeviations.map((d) => d.code) };
}

/** 修正後の規則（対象の規則 ID の規則だけを差し替える） */
export function patchedRules(rules: RuleVersion[], p: Patch): { rules: RuleVersion[]; applicable: boolean } {
  const idx = rules.findIndex((r) => r.ruleKey === p.targetRuleKey);
  if (idx < 0 || !p.after) return { rules, applicable: idx >= 0 };
  const patched = [...rules];
  patched[idx] = { ...rules[idx], ...p.after, ruleKey: p.targetRuleKey, id: `patch:${p.id}`, logicHash: 'patched' };
  return { rules: patched, applicable: true };
}

const rate = (k: number, n: number): RateWithCi => ({ ...wilson(k, n) });

export function decideGate(m: RegressionRun['metrics'], t: GateThresholds, opts: { needsReview: boolean; addedCost: number | null; counts: { reject: number; accept: number } }): { gate: GateResult; reasons: string[] } {
  const fails: string[] = [];
  const unsure: string[] = [];
  const fr = m.falseRejection.after;
  const pv = m.prevention.after;
  const pf = m.previouslyFixed.after;
  if (opts.counts.reject < t.minCasesPerDataset) unsure.push(`防ぐべきケースが ${opts.counts.reject} 件で、最小件数（${t.minCasesPerDataset}）に足りません。`);
  if (opts.counts.accept < t.minCasesPerDataset) unsure.push(`正常なケースが ${opts.counts.accept} 件で、最小件数（${t.minCasesPerDataset}）に足りません。`);
  if (fr.p !== null && fr.p > t.maxFalseRejectionRate) fails.push(`修正後の誤拒否率 ${(fr.p * 100).toFixed(1)}% が上限 ${(t.maxFalseRejectionRate * 100).toFixed(1)}% を超えています。`);
  else if (fr.ci && fr.ci[1] > t.maxFalseRejectionRate) unsure.push(`誤拒否率の 95% 上限 ${(fr.ci[1] * 100).toFixed(1)}% が上限を超えています（件数を増やすと判断できる可能性があります）。`);
  if (pv.p !== null && pv.p < t.minPreventionRate) fails.push(`既知の Failure を防げた割合 ${(pv.p * 100).toFixed(1)}% が下限 ${(t.minPreventionRate * 100).toFixed(1)}% を下回っています。`);
  else if (pv.ci && pv.ci[0] < t.minPreventionRate) unsure.push(`防げた割合の 95% 下限 ${(pv.ci[0] * 100).toFixed(1)}% が下限を下回っています。`);
  if (pf.p !== null && pf.p < t.minPreviouslyFixedPassRate) fails.push(`修正済みケースの再発があります（成功率 ${(pf.p * 100).toFixed(1)}%）。`);
  if (t.maxAddedCostUsd !== null && opts.addedCost !== null && opts.addedCost > t.maxAddedCostUsd) fails.push(`再実験での追加費用 $${opts.addedCost.toFixed(4)} が上限を超えています。`);
  if (fails.length) return { gate: 'FAIL', reasons: [...fails, ...unsure] };
  if (unsure.length) return { gate: 'INCONCLUSIVE', reasons: unsure };
  if (opts.needsReview) return { gate: 'REVIEW_REQUIRED', reasons: ['人が確認していない（候補の）テストケース、または期待する趣旨が未確定のケースを含みます。'] };
  return { gate: 'PASS', reasons: ['すべての閾値を 95% 区間で満たしています。'] };
}

async function experimentSummary(studyId: string | null): Promise<RegressionRun['experiment']> {
  if (!studyId) return null;
  const study = await getStudy(studyId);
  if (!study || study.status !== 'completed') return null;
  const sessions = await listSessions(studyId);
  const stats = computeStudyStats(study, sessions, await listDecisions(studyId));
  const C = stats.conditions.find((c) => c.conditionId === 'C');
  const T = stats.conditions.find((c) => c.conditionId === 'T');
  if (!C || !T) return null;
  return {
    studyId,
    isMock: study.isMock,
    violationRate: { control: C.ruleViolationRate.p, treatment: T.ruleViolationRate.p },
    meanPnl: { control: C.pnl.mean, treatment: T.pnl.mean },
    costUsd: { control: C.costUsd, treatment: T.costUsd },
    meanSessionSeconds: { control: C.sessionSeconds.mean, treatment: T.sessionSeconds.mean },
    failedSessions: { control: C.sessions.failed, treatment: T.sessions.failed },
  };
}

/** 修正案の回帰テストを実行して保存する */
export async function runRegression(patchId: string, input: Record<string, unknown>, actor: Principal): Promise<RegressionRun> {
  const p = await getPatch(patchId);
  if (!p) throw new ValidationError('修正案が見つかりません。');
  if (!['approved_for_simulation', 'simulation_completed', 'approved_for_recommendation'].includes(p.status)) {
    throw new ValidationError('実験への使用が承認された修正案のみ回帰テストを実行できます。');
  }
  const thresholds = parseThresholds(input.thresholds);
  const includeCandidates = input.includeCandidates === true;
  const cases = (await listTestCases()).filter((t) => t.status === 'approved' || (includeCandidates && t.status === 'candidate'));
  if (cases.length === 0) throw new ValidationError('回帰テストに使えるテストケースがありません（Failure Library でテストケースを作成・承認してください）。');
  const ruleCache = new Map<string, RuleVersion[]>();
  const outcomes: CaseOutcome[] = [];
  for (const t of cases) {
    const key = t.ruleVersionIds.join(',');
    if (!ruleCache.has(key)) ruleCache.set(key, await getRuleVersions(t.ruleVersionIds));
    const before = ruleCache.get(key)!;
    const { rules: after, applicable } = patchedRules(before, p);
    const b = judge(t, before);
    const a = judge(t, after);
    const exp = expectation(t);
    const pass = (r: { verdict: string }) => (exp === 'accept' ? r.verdict === 'ACCEPT' || r.verdict === 'NO_ORDER' : r.verdict === 'REJECT');
    outcomes.push({ testCaseId: t.id, dataset: t.dataset, status: t.status, title: t.title, before: b, after: a, passBefore: pass(b), passAfter: pass(a), applicable });
  }
  const used = outcomes.filter((o) => o.applicable);
  const expOf = new Map(cases.map((t) => [t.id, expectation(t)]));
  const rejectCases = used.filter((o) => expOf.get(o.testCaseId) === 'reject' && o.dataset !== 'previously_fixed');
  const acceptCases = used.filter((o) => expOf.get(o.testCaseId) === 'accept');
  const fixed = used.filter((o) => o.dataset === 'previously_fixed');
  const prevention = { before: rate(rejectCases.filter((o) => o.passBefore).length, rejectCases.length), after: rate(rejectCases.filter((o) => o.passAfter).length, rejectCases.length) };
  const falseRejection = { before: rate(acceptCases.filter((o) => !o.passBefore).length, acceptCases.length), after: rate(acceptCases.filter((o) => !o.passAfter).length, acceptCases.length) };
  const metrics: RegressionRun['metrics'] = {
    prevention,
    falseRejection,
    previouslyFixed: { after: rate(fixed.filter((o) => o.passAfter).length, fixed.length) },
    newFailures: used.filter((o) => o.passBefore && !o.passAfter).length,
    notApplicable: outcomes.length - used.length,
    riskReduction: prevention.after.p !== null && prevention.before.p !== null ? prevention.after.p - prevention.before.p : null,
    falseRejectionIncrease: falseRejection.after.p !== null && falseRejection.before.p !== null ? falseRejection.after.p - falseRejection.before.p : null,
  };
  const experiment = await experimentSummary(p.experimentStudyId);
  const addedCost = experiment ? experiment.costUsd.treatment - experiment.costUsd.control : null;
  const needsReview = used.some((o) => o.status === 'candidate') || cases.some((t) => used.some((o) => o.testCaseId === t.id) && !t.expectedIntent);
  const { gate, reasons } = decideGate(metrics, thresholds, { needsReview, addedCost, counts: { reject: rejectCases.length, accept: acceptCases.length } });
  const reasonsAll = [...reasons];
  if (!p.after) reasonsAll.push('提示方法の修正は形式判定を変えないため、効果は再実験（行動の比較）で評価してください。');
  if (p.isMock) reasonsAll.push('修正案の元の Failure はモックデータから検出されたものです。');
  const run: RegressionRun = {
    id: randomUUID(),
    patchId,
    createdAt: new Date().toISOString(),
    createdBy: actor.displayName,
    thresholds,
    includeCandidates,
    outcomes,
    metrics,
    experiment,
    gate,
    gateReasons: reasonsAll,
    engineVersion: ENGINE_VERSION,
  };
  await insertRegressionRun(run);
  await audit(actor, 'regression.run', patchId, 'success', gate);
  return run;
}

/** リスク低減（大きいほどよい）と誤拒否の増加（小さいほどよい）で、他の案に劣らない修正案 */
export function paretoFrontier<T extends { id: string; risk: number; falseRejection: number }>(points: T[]): Set<string> {
  const frontier = new Set<string>();
  for (const a of points) {
    const dominated = points.some((b) => b.id !== a.id && b.risk >= a.risk && b.falseRejection <= a.falseRejection && (b.risk > a.risk || b.falseRejection < a.falseRejection));
    if (!dominated) frontier.add(a.id);
  }
  return frontier;
}

/** 修正案の一覧と、最新の回帰テストに基づく比較（パレート最適かどうか） */
export async function patchOverview() {
  const [patches, runs] = await Promise.all([listPatches(), listRegressionRuns()]);
  const latest = new Map<string, RegressionRun>();
  for (const r of runs) if (!latest.has(r.patchId)) latest.set(r.patchId, r);
  const points = patches
    .map((p) => ({ id: p.id, run: latest.get(p.id) }))
    .filter((x) => x.run && x.run.metrics.riskReduction !== null && x.run.metrics.falseRejectionIncrease !== null)
    .map((x) => ({ id: x.id, risk: x.run!.metrics.riskReduction!, falseRejection: x.run!.metrics.falseRejectionIncrease! }));
  const frontier = paretoFrontier(points);
  return patches.map((p) => {
    const r = latest.get(p.id);
    return {
      patch: p,
      latest: r ? { id: r.id, gate: r.gate, metrics: r.metrics, createdAt: r.createdAt, experiment: r.experiment } : null,
      pareto: frontier.has(p.id),
    };
  });
}
