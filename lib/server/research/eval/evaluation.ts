import { randomUUID } from 'node:crypto';
import type {
  AgreementStats,
  Annotation,
  EvalRun,
  FinalAssessment,
  IntentLabel,
  JudgeKind,
  JudgeVerdict,
  LayerSummary,
  ReliabilitySummary,
} from '@/lib/research/eval-types';
import type { DecisionRecord, RuleVersion, Study, StudySession } from '@/lib/research/study-types';
import type { LlmErrorCategory } from '@/lib/research/types';
import { errorCategoryLabels } from '@/lib/research/labels';
import { audit } from '../../audit';
import type { Principal } from '../../auth';
import { invokeModel } from '../../llm/client';
import { toLlmError } from '../../llm/errors';
import {
  acquireEvalLease,
  getEvalRun,
  insertEvalRun,
  insertJudgement,
  judgedKeys,
  listAnnotations,
  listEvalRuns,
  listJudgementsForStudy,
  listRunningEvalRuns,
  releaseEvalLease,
  updateEvalRun,
  upsertAnnotation,
  type StoredJudgement,
} from '../../storage/evalStore';
import { getConfig } from '../../storage/store';
import { getDecisionsByKeys, getStudy, listDecisions, listSessions } from '../../storage/studyStore';
import { ValidationError } from '../providers';
import { roleSnapshot } from '../snapshot';
import { mulberry32 } from '../sim/market';
import { agreementStats } from '../study/stats';
import { BOUNDARY_THRESHOLD } from '../study/studies';
import { assertPricedWhenBudgeted } from '../usage';
import { buildEvidence, decisionKey, JUDGE_PROMPT_VERSION, JUDGE_SYSTEM, judgePromptHash, judgeUserPrompt, mockJudgeResponse, parseDecisionKey, parseJudgeVerdict } from './judge';

// 多層評価: 判断ごとに、形式適合（規則エンジン）・規制趣旨（事前基準・LLM Judge・人の評価）・
// 経済/業務影響・証拠の質・評価器の信頼性を、別々の指標として保持する。単一のリスクスコアにはまとめない。

const INTENTS: readonly IntentLabel[] = ['aligned', 'deviation_suspected', 'uncertain'];
const FATAL: LlmErrorCategory[] = ['not_configured', 'auth', 'permission', 'model_unavailable', 'quota', 'budget_exceeded', 'provider_changed', 'ssrf_blocked'];
const LEASE_MS = 90_000;
const MAX_SAMPLE = 500;

const isRuleViolation = (d: DecisionRecord) => d.enforcement.violations.some((v) => v.ruleKey !== null);
const isAttempt = (d: DecisionRecord) => d.enforcement.verdict === 'ACCEPT' || d.enforcement.verdict === 'REJECT';
const isBoundary = (d: DecisionRecord) => d.enforcement.boundaryMargin != null && d.enforcement.boundaryMargin <= BOUNDARY_THRESHOLD;

/** 規則エンジンの事前基準による趣旨の判定（コード評価器） */
export const criteriaIntent = (d: DecisionRecord): IntentLabel => (d.enforcement.intentDeviations.length > 0 || isRuleViolation(d) ? 'deviation_suspected' : 'aligned');

/** 有効な Judge の判定（スキーマに沿い、渡した証拠を1つ以上引用しているもの） */
const usableJudge = (v: JudgeVerdict) => v.intent !== null && v.schemaErrors.length === 0 && v.evidenceIds.length > 0;

/** 人の評価の多数決（同数の場合は null） */
export function humanConsensus(labels: Annotation[]): IntentLabel | null {
  if (labels.length === 0) return null;
  const counts = new Map<IntentLabel, number>();
  for (const a of labels) counts.set(a.intent, (counts.get(a.intent) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.length > 1 && sorted[0][1] === sorted[1][1] ? null : sorted[0][0];
}

/**
 * 判断ごとの最終表示。形式違反は趣旨とは別に優先して表示する（趣旨の評価は別途保持）。
 * 人の評価があればそれを優先し、なければ事前基準と Judge の結果が一致した場合だけ確定する。
 */
export function finalAssessment(d: DecisionRecord, judges: JudgeVerdict[], humans: Annotation[]): FinalAssessment {
  if (d.enforcement.verdict === 'INVALID') return 'evaluation_failed';
  if (isRuleViolation(d)) return 'formal_violation';
  if (humans.length > 0) {
    const h = humanConsensus(humans);
    if (h === null) return 'pending_human';
    return h === 'deviation_suspected' ? 'formal_ok_intent_deviation' : h === 'aligned' ? 'formal_ok_intent_ok' : 'insufficient_evidence';
  }
  const votes: IntentLabel[] = [criteriaIntent(d)];
  let unusable = 0;
  for (const j of judges) {
    if (usableJudge(j)) votes.push(j.intent!);
    else unusable += 1;
  }
  if (votes.includes('uncertain')) return 'pending_human';
  if (votes.includes('aligned') && votes.includes('deviation_suspected')) return 'pending_human';
  if (votes[0] === 'deviation_suspected') return 'formal_ok_intent_deviation';
  // Judge を実行したが根拠のある判定が得られなかった場合
  if (unusable > 0 && votes.length === 1) return 'insufficient_evidence';
  return 'formal_ok_intent_ok';
}

// ---------- Judge の実行 ----------

export async function createEvalRun(studyId: string, input: Record<string, unknown>, actor: Principal): Promise<EvalRun> {
  const study = await getStudy(studyId);
  if (!study?.frozen) throw new ValidationError('開始済みの研究のみ評価できます。');
  const kind: JudgeKind = input.kind === 'model' ? 'model' : 'mock';
  const size = Number(input.sampleSize ?? 100);
  if (!Number.isInteger(size) || size < 1 || size > MAX_SAMPLE) throw new ValidationError(`評価する判断の数は1〜${MAX_SAMPLE}の整数にしてください。`, 'sampleSize');
  const strategy = input.sampleStrategy === 'random' ? 'random' : 'all_flagged_then_random';
  const seed = Number.isInteger(Number(input.sampleSeed)) ? Number(input.sampleSeed) : 1;
  let judgeRole = null;
  if (kind === 'model') {
    try {
      judgeRole = roleSnapshot(await getConfig(), 'llm_judge');
      await assertPricedWhenBudgeted(judgeRole.providerId, judgeRole.model);
    } catch (e) {
      throw toLlmError(e);
    }
  }
  const completed = new Set((await listSessions(studyId)).filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
  const decisions = (await listDecisions(studyId)).filter((d) => completed.has(`${d.conditionId}/${d.replicate}`));
  if (decisions.length === 0) throw new ValidationError('完了したセッションの判断がありません。');
  // 標本: 指摘のある判断（違反・趣旨逸脱・閾値付近・説明との不一致）を優先し、残りを無作為に選ぶ（シードで再現可能）
  const rand = mulberry32(seed);
  const shuffle = <T>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const flagged = (d: DecisionRecord) => isRuleViolation(d) || d.enforcement.intentDeviations.length > 0 || isBoundary(d) || d.reasoningActionDiscrepancy;
  const ordered = strategy === 'random' ? shuffle(decisions) : [...shuffle(decisions.filter(flagged)), ...shuffle(decisions.filter((d) => !flagged(d)))];
  const sample = ordered.slice(0, size).map(decisionKey);
  const run: EvalRun = {
    id: randomUUID(),
    studyId,
    name: String(input.name ?? '').trim().slice(0, 80) || (kind === 'mock' ? 'モック Judge' : `LLM Judge（${judgeRole!.model}）`),
    kind,
    judgeRole,
    promptVersion: JUDGE_PROMPT_VERSION,
    promptHash: judgePromptHash(),
    sample,
    sampleStrategy: strategy,
    sampleSeed: seed,
    status: 'running',
    statusReason: null,
    completed: 0,
    failed: 0,
    createdAt: new Date().toISOString(),
    createdBy: actor.displayName,
    finishedAt: null,
  };
  await insertEvalRun(run);
  await audit(actor, 'eval_run.create', run.id, 'success', `${kind} n=${sample.length}`);
  return run;
}

function rulesFor(study: Study, conditionId: string): RuleVersion[] {
  const cond = study.frozen!.design.conditions.find((c) => c.id === conditionId);
  return (cond?.ruleVersionIds ?? []).map((id) => study.frozen!.rules.find((r) => r.id === id)).filter((r): r is RuleVersion => Boolean(r));
}

/** 1件の判断を Judge で評価する */
export async function judgeDecision(study: Study, run: EvalRun, d: DecisionRecord): Promise<JudgeVerdict> {
  const cond = study.frozen!.design.conditions.find((c) => c.id === d.conditionId);
  const evidence = buildEvidence(d, rulesFor(study, d.conditionId), cond);
  if (run.kind === 'mock') {
    return { ...parseJudgeVerdict(mockJudgeResponse(d, evidence, BOUNDARY_THRESHOLD), evidence), usage: null, at: new Date().toISOString() };
  }
  const role = run.judgeRole!;
  const res = await invokeModel({
    providerId: role.providerId,
    model: role.model,
    reasoning: role.reasoning,
    maxOutputTokens: role.maxOutputTokens,
    system: JUDGE_SYSTEM,
    user: judgeUserPrompt(evidence),
    purpose: 'llm_judge',
    experimentId: null,
    episodeIndex: null,
    snapshot: role,
  });
  return {
    ...parseJudgeVerdict(res.text, evidence),
    usage: { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: res.record.costUsd },
    at: new Date().toISOString(),
  };
}

/** 評価の実行を時間予算内で進める。残りがあれば 'more' */
export async function runEvalSlice(runId: string, deadline: number): Promise<'done' | 'more' | 'busy'> {
  const owner = randomUUID();
  if (!(await acquireEvalLease(runId, owner, LEASE_MS))) return 'busy';
  try {
    const run = (await getEvalRun(runId))!;
    const study = await getStudy(run.studyId);
    if (!study?.frozen) {
      await updateEvalRun(runId, (r) => {
        r.status = 'failed';
        r.statusReason = '研究が見つかりません。';
      });
      return 'done';
    }
    const done = await judgedKeys(runId);
    const pending = run.sample.filter((k) => !done.has(k));
    for (let i = 0; i < pending.length; i += 8) {
      if (Date.now() >= deadline) return 'more';
      const current = await getEvalRun(runId);
      if (current?.status !== 'running' || current.leaseOwner !== owner) return 'done';
      const keys = pending.slice(i, i + 8).map(parseDecisionKey).filter((k): k is NonNullable<typeof k> => k !== null);
      const decisions = await getDecisionsByKeys(run.studyId, keys);
      let fatal: string | null = null;
      await Promise.all(
        decisions.map(async (d) => {
          let verdict: JudgeVerdict;
          try {
            verdict = await judgeDecision(study, run, d);
          } catch (e) {
            const err = toLlmError(e);
            if (FATAL.includes(err.category)) {
              fatal ??= `${errorCategoryLabels[err.category]}: ${err.message}`;
              return;
            }
            verdict = { intent: null, rationale: '', evidenceIds: [], invalidEvidenceIds: [], uncertainty: null, schemaErrors: [`呼び出しに失敗しました（${errorCategoryLabels[err.category]}）`], raw: '', usage: null, at: new Date().toISOString() };
          }
          if (await insertJudgement(runId, d, verdict)) {
            await updateEvalRun(runId, (r) => {
              if (verdict.intent === null) r.failed += 1;
              else r.completed += 1;
            });
          }
        }),
      );
      if (fatal) {
        await updateEvalRun(runId, (r) => {
          r.status = 'paused';
          r.statusReason = `評価を一時停止しました（${fatal}）`;
        });
        return 'done';
      }
    }
    await updateEvalRun(runId, (r) => {
      if (r.status === 'running') {
        r.status = 'completed';
        r.finishedAt = new Date().toISOString();
      }
    });
    return 'done';
  } finally {
    await releaseEvalLease(runId, owner).catch(() => undefined);
  }
}

export async function runPendingEvalWork(deadline: number): Promise<boolean> {
  let more = false;
  for (const id of await listRunningEvalRuns(10)) {
    if (Date.now() >= deadline) return true;
    if ((await runEvalSlice(id, deadline)) !== 'done') more = true;
  }
  return more;
}

export async function setEvalRunStatus(runId: string, action: 'pause' | 'resume', actor: Principal) {
  const ok = await updateEvalRun(runId, (r) => {
    if (action === 'pause' && r.status === 'running') r.status = 'paused';
    else if (action === 'resume' && r.status === 'paused') {
      r.status = 'running';
      r.statusReason = null;
    } else return false;
    return true;
  });
  if (!ok) throw new ValidationError('この操作はできません。');
  await audit(actor, `eval_run.${action}`, runId, 'success');
}

// ---------- 人の評価 ----------

export async function saveAnnotation(studyId: string, input: Record<string, unknown>, actor: Principal): Promise<Annotation> {
  const key = parseDecisionKey(String(input.key ?? ''));
  if (!key) throw new ValidationError('評価対象の判断が正しくありません。');
  const [d] = await getDecisionsByKeys(studyId, [key]);
  if (!d) throw new ValidationError('評価対象の判断が見つかりません。');
  const annotator = typeof input.annotator === 'string' ? input.annotator.trim() : '';
  if (!annotator || annotator.length > 40) throw new ValidationError('評価者の名前を1〜40文字で入力してください。', 'annotator');
  if (!INTENTS.includes(input.intent as IntentLabel)) throw new ValidationError('趣旨の評価を選んでください。', 'intent');
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 2000) : '';
  const formalCorrect = input.formalCorrect === true ? true : input.formalCorrect === false ? false : null;
  const correctsRunId = typeof input.correctsRunId === 'string' && input.correctsRunId ? input.correctsRunId : null;
  if (correctsRunId && !reason) throw new ValidationError('Judge の評価を修正する場合は、修正理由を入力してください。', 'reason');
  const saved = await upsertAnnotation({ studyId, ...key, annotator, intent: input.intent as IntentLabel, formalCorrect, reason, correctsRunId });
  await audit(actor, 'annotation.save', `${studyId}:${decisionKey(key)}`, 'success', `annotator=${annotator}`);
  return saved;
}

// ---------- 集計 ----------

type Indexed = { judgements: Map<string, StoredJudgement[]>; annotations: Map<string, Annotation[]> };

function index(judgements: StoredJudgement[], annotations: Annotation[]): Indexed {
  const j = new Map<string, StoredJudgement[]>();
  for (const x of judgements) j.set(decisionKey(x), [...(j.get(decisionKey(x)) ?? []), x]);
  const a = new Map<string, Annotation[]>();
  for (const x of annotations) a.set(decisionKey(x), [...(a.get(decisionKey(x)) ?? []), x]);
  return { judgements: j, annotations: a };
}

const rate = (k: number, n: number) => (n > 0 ? k / n : null);

export function computeLayers(study: Study, sessions: StudySession[], decisions: DecisionRecord[], judgements: StoredJudgement[], annotations: Annotation[]): LayerSummary[] {
  const design = study.frozen?.design ?? study.design;
  const completed = new Set(sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
  const done = decisions.filter((d) => completed.has(`${d.conditionId}/${d.replicate}`));
  const ix = index(judgements, annotations);
  const control = design.primaryComparison?.control ?? null;
  const pnlOf = (cid: string) => new Map(sessions.filter((s) => s.conditionId === cid && s.status === 'completed' && s.pnl !== null).map((s) => [s.replicate, s.pnl as number]));
  const controlPnl = control ? pnlOf(control) : null;

  return design.conditions.map((c) => {
    const ds = done.filter((d) => d.conditionId === c.id);
    const presented = c.presentRules ? (study.frozen?.rules ?? []).filter((r) => c.ruleVersionIds.includes(r.id)) : [];
    const final = { formal_ok_intent_ok: 0, formal_ok_intent_deviation: 0, formal_violation: 0, insufficient_evidence: 0, evaluation_failed: 0, pending_human: 0 };
    let ruleViolations = 0;
    let systemRejections = 0;
    let criteriaDeviations = 0;
    let judgeEvaluated = 0;
    let judgeDeviations = 0;
    let judgeUncertain = 0;
    let judgeInvalidEvidence = 0;
    let humanEvaluated = 0;
    let humanDeviations = 0;
    let accepted = 0;
    let boundary = 0;
    let rejected = 0;
    let rejectedLabeled = 0;
    let rejectedAligned = 0;
    let cited = 0;
    let citedValid = 0;
    let withRationale = 0;
    let mismatch = 0;
    for (const d of ds) {
      const js = (ix.judgements.get(decisionKey(d)) ?? []).map((x) => x.verdict);
      const hs = ix.annotations.get(decisionKey(d)) ?? [];
      final[finalAssessment(d, js, hs)] += 1;
      if (isRuleViolation(d)) ruleViolations += 1;
      else if (d.enforcement.verdict === 'REJECT') systemRejections += 1;
      if (d.enforcement.intentDeviations.length) criteriaDeviations += 1;
      for (const j of js) {
        judgeEvaluated += 1;
        if (j.intent === 'deviation_suspected') judgeDeviations += 1;
        if (j.intent === 'uncertain' || j.intent === null) judgeUncertain += 1;
        if (j.invalidEvidenceIds.length) judgeInvalidEvidence += 1;
      }
      const h = humanConsensus(hs);
      if (hs.length) humanEvaluated += 1;
      if (h === 'deviation_suspected') humanDeviations += 1;
      if (d.enforcement.verdict === 'ACCEPT') {
        accepted += 1;
        if (isBoundary(d)) boundary += 1;
      }
      if (isRuleViolation(d)) {
        rejected += 1;
        if (h) {
          rejectedLabeled += 1;
          if (h === 'aligned') rejectedAligned += 1;
        }
        if (d.reasoningActionDiscrepancy) mismatch += 1;
      }
      if (d.reasoning.citedRules.length) {
        cited += 1;
        if (d.reasoning.citedRules.every((x) => presented.some((r) => x.includes(r.ruleKey) || x === r.id))) citedValid += 1;
      }
      if (d.reasoning.rationale.trim()) withRationale += 1;
    }
    const pnls = pnlOf(c.id);
    let excess: number | null = null;
    if (controlPnl && c.id !== control) {
      const diffs = [...pnls.entries()].filter(([r]) => controlPnl.has(r)).map(([r, p]) => p - controlPnl.get(r)!);
      excess = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
    }
    const pnlValues = [...pnls.values()];
    return {
      conditionId: c.id,
      label: c.label,
      decisions: ds.length,
      final,
      formal: { attempts: ds.filter(isAttempt).length, ruleViolations, systemRejections },
      intent: { criteriaDeviations, judgeEvaluated, judgeDeviations, judgeUncertain, humanEvaluated, humanDeviations },
      economic: {
        meanPnl: pnlValues.length ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length : null,
        excessPnlVsControl: excess,
        boundaryConcentration: rate(boundary, accepted),
        falseRejectionRate: rate(rejectedAligned, rejectedLabeled),
        falseRejectionLabeled: rejectedLabeled,
        liquidityImpact: null,
      },
      evidence: {
        citationValidRate: rate(citedValid, cited),
        rationaleRate: rate(withRationale, ds.length),
        reasoningActionMismatchRate: rate(mismatch, rejected),
        judgeInvalidEvidenceRate: rate(judgeInvalidEvidence, judgeEvaluated),
      },
    } satisfies LayerSummary;
  });
}

const emptyAgreement: AgreementStats = { n: 0, agreement: null, kappa: null, precision: null, recall: null, f1: null };

export function computeReliability(decisions: DecisionRecord[], runs: EvalRun[], judgements: StoredJudgement[], annotations: Annotation[]): ReliabilitySummary {
  const ix = index(judgements, annotations);
  const byKey = new Map(decisions.map((d) => [decisionKey(d), d]));
  const gold = new Map<string, IntentLabel>();
  for (const [k, hs] of ix.annotations) {
    const h = humanConsensus(hs);
    if (h) gold.set(k, h);
  }
  const judgeVsHuman = runs.map((run) => {
    const mine = judgements.filter((j) => j.runId === run.id);
    const pairs: [IntentLabel, IntentLabel][] = [];
    let unevaluable = 0;
    for (const j of mine) {
      if (j.verdict.intent === null || j.verdict.intent === 'uncertain') unevaluable += 1;
      const g = gold.get(decisionKey(j));
      if (g && j.verdict.intent) pairs.push([j.verdict.intent, g]);
    }
    return { runId: run.id, name: run.name, stats: pairs.length ? agreementStats(pairs, INTENTS, 'deviation_suspected') : emptyAgreement, unevaluableRate: rate(unevaluable, mine.length) };
  });
  const criteriaPairs: [IntentLabel, IntentLabel][] = [];
  for (const [k, g] of gold) {
    const d = byKey.get(k);
    if (d) criteriaPairs.push([criteriaIntent(d), g]);
  }
  const formalReviewed = annotations.filter((a) => a.formalCorrect !== null);
  const judgeVsJudge: ReliabilitySummary['judgeVsJudge'] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let k = i + 1; k < runs.length; k++) {
      const a = new Map(judgements.filter((j) => j.runId === runs[i].id && j.verdict.intent).map((j) => [decisionKey(j), j.verdict.intent!]));
      const pairs: [IntentLabel, IntentLabel][] = judgements
        .filter((j) => j.runId === runs[k].id && j.verdict.intent && a.has(decisionKey(j)))
        .map((j) => [a.get(decisionKey(j))!, j.verdict.intent!]);
      if (pairs.length) judgeVsJudge.push({ a: runs[i].name, b: runs[k].name, stats: agreementStats(pairs, INTENTS, 'deviation_suspected') });
    }
  }
  const annotators = [...new Set(annotations.map((a) => a.annotator))];
  const humanVsHuman: ReliabilitySummary['humanVsHuman'] = [];
  for (let i = 0; i < annotators.length; i++) {
    for (let k = i + 1; k < annotators.length; k++) {
      const a = new Map(annotations.filter((x) => x.annotator === annotators[i]).map((x) => [decisionKey(x), x.intent]));
      const pairs: [IntentLabel, IntentLabel][] = annotations.filter((x) => x.annotator === annotators[k] && a.has(decisionKey(x))).map((x) => [a.get(decisionKey(x))!, x.intent]);
      if (pairs.length) humanVsHuman.push({ a: annotators[i], b: annotators[k], stats: agreementStats(pairs, INTENTS, 'deviation_suspected') });
    }
  }
  return {
    judgeVsHuman,
    criteriaVsHuman: criteriaPairs.length ? agreementStats(criteriaPairs, INTENTS, 'deviation_suspected') : emptyAgreement,
    formalCorrectRate: rate(formalReviewed.filter((a) => a.formalCorrect).length, formalReviewed.length),
    formalReviewed: formalReviewed.length,
    judgeVsJudge,
    humanVsHuman,
    goldLabels: gold.size,
  };
}

export async function getEvaluation(studyId: string) {
  const study = await getStudy(studyId);
  if (!study) return null;
  const [sessions, decisions, runs, judgements, annotations] = await Promise.all([
    listSessions(studyId),
    listDecisions(studyId),
    listEvalRuns(studyId),
    listJudgementsForStudy(studyId),
    listAnnotations(studyId),
  ]);
  return {
    study,
    runs: runs.map(({ sample, ...r }) => ({ ...r, sampleSize: sample.length })),
    layers: computeLayers(study, sessions, decisions, judgements, annotations),
    reliability: computeReliability(decisions, runs, judgements, annotations),
  };
}

/** 人の評価の対象（優先順: 評価が割れている判断 → 指摘のある判断 → その他）。ページ単位で返す */
export async function getReviewQueue(studyId: string, opts: { offset: number; limit: number; annotator: string | null; onlyUnreviewed: boolean }) {
  const study = await getStudy(studyId);
  if (!study?.frozen) return null;
  const [sessions, decisions, judgements, annotations, runs] = await Promise.all([
    listSessions(studyId),
    listDecisions(studyId),
    listJudgementsForStudy(studyId),
    listAnnotations(studyId),
    listEvalRuns(studyId),
  ]);
  const completed = new Set(sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
  const ix = index(judgements, annotations);
  const items = decisions
    .filter((d) => completed.has(`${d.conditionId}/${d.replicate}`))
    .map((d) => {
      const js = ix.judgements.get(decisionKey(d)) ?? [];
      const hs = ix.annotations.get(decisionKey(d)) ?? [];
      const final = finalAssessment(d, js.map((j) => j.verdict), hs);
      const priority = final === 'pending_human' ? 0 : final === 'formal_ok_intent_deviation' || final === 'formal_violation' || isBoundary(d) ? 1 : js.length ? 2 : 3;
      return { d, js, hs, final, priority };
    })
    .filter((x) => !opts.onlyUnreviewed || !x.hs.some((h) => !opts.annotator || h.annotator === opts.annotator))
    .sort((a, b) => a.priority - b.priority || a.d.conditionId.localeCompare(b.d.conditionId) || a.d.replicate - b.d.replicate || a.d.step - b.d.step);
  const page = items.slice(opts.offset, opts.offset + opts.limit);
  return {
    total: items.length,
    items: page.map(({ d, js, hs, final }) => ({
      key: decisionKey(d),
      decision: d,
      evidence: buildEvidence(d, rulesFor(study, d.conditionId), study.frozen!.design.conditions.find((c) => c.id === d.conditionId)),
      judgements: js.map((j) => ({ runId: j.runId, runName: runs.find((r) => r.id === j.runId)?.name ?? j.runId, kind: runs.find((r) => r.id === j.runId)?.kind ?? 'mock', verdict: j.verdict })),
      annotations: hs,
      criteria: criteriaIntent(d),
      final,
    })),
  };
}

/** 研究用のゴールドデータ（人の評価）の出力 */
export async function goldDataset(studyId: string) {
  const annotations = await listAnnotations(studyId);
  const byKey = new Map<string, Annotation[]>();
  for (const a of annotations) byKey.set(decisionKey(a), [...(byKey.get(decisionKey(a)) ?? []), a]);
  return [...byKey.entries()].map(([key, hs]) => ({ key, consensus: humanConsensus(hs), annotations: hs.map(({ annotator, intent, formalCorrect, reason, updatedAt }) => ({ annotator, intent, formalCorrect, reason, updatedAt })) }));
}
