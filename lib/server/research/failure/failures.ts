import { randomUUID } from 'node:crypto';
import type { Annotation, IntentLabel } from '@/lib/research/eval-types';
import type { Failure, FailureCategory, FailureCluster, FailureSeverity, Hypothesis, TestCase, TestDataset } from '@/lib/research/failure-types';
import type { DecisionRecord, RuleVersion, Study } from '@/lib/research/study-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth';
import { listAnnotations, listEvalRuns, listJudgementsForStudy } from '../../storage/evalStore';
import { insertFailures, insertTestCase, listFailures, listHypotheses, listTestCases, updateFailure, updateTestCase } from '../../storage/failureStore';
import { getStudy, listDecisions, listSessions } from '../../storage/studyStore';
import { traceIdsForStudy } from '../../storage/traceStore';
import { contentHash } from '../../util/canonical';
import { humanConsensus } from '../eval/evaluation';
import { decisionKey } from '../eval/judge';
import { ValidationError } from '../providers';
import { mulberry32 } from '../sim/market';
import { ENGINE_VERSION } from '../study/exports';
import { BOUNDARY_THRESHOLD } from '../study/studies';

// Failure-to-Test パイプライン:
// 実験 → 逸脱の疑いを検出 → Failure として登録（判断ごとに1件）→ 特徴で分類（クラスター）→ 再現条件を抽出
// → テストケース候補 → 研究者の確認（期待する趣旨の判定を人が確定）→ 回帰テストのデータセットへ。

const CATEGORY_LABEL: Record<FailureCategory, string> = {
  formal_violation: '形式違反',
  intent_deviation: '趣旨逸脱の疑い',
  boundary_exploitation: '閾値付近の行動',
};
const SEVERITY_ORDER: FailureSeverity[] = ['low', 'medium', 'high'];
const MAX_DETECT = 5000;

const quantityBand = (q: number | null) => (q === null ? 'n/a' : q < 100 ? 'small' : q < 500 ? 'medium' : 'large');
const BAND_LABEL: Record<string, string> = { small: '小口', medium: '中口', large: '大口', 'n/a': '' };
const TREND_LABEL: Record<string, string> = { up: '上昇局面', down: '下落局面', flat: '横ばい' };
const SIDE_LABEL: Record<string, string> = { long: '買い持ち', flat: '保有なし', short: '売り持ち' };
const ACTION_LABEL: Record<string, string> = { buy: '買い', sell: '売り', cancel: '取消', hold: '見送り', invalid: '解釈不能' };

const trendOf = (c: DecisionRecord['context']) => (c.price > c.lastTradePrice * 1.005 ? 'up' : c.price < c.lastTradePrice * 0.995 ? 'down' : 'flat');
const sideOf = (position: number) => (position > 0 ? 'long' : position < 0 ? 'short' : 'flat');

/** 分類の鍵（同じ規則・コード・行動の種類・市場の局面の Failure は同じクラスター） */
export function fingerprintOf(f: Pick<Failure, 'category' | 'ruleKeys' | 'codes' | 'action' | 'market'>): string {
  return contentHash([f.category, [...f.ruleKeys].sort(), [...f.codes].sort(), f.action.action ?? 'invalid', quantityBand(f.action.quantity), f.market.trend, sideOf(f.market.position)]).slice(0, 16);
}

function clusterLabel(f: Failure): string {
  const parts = [
    CATEGORY_LABEL[f.category],
    f.ruleKeys.join('+') || '規則なし',
    f.codes.join('+'),
    `${ACTION_LABEL[f.action.action ?? 'invalid'] ?? f.action.action}${BAND_LABEL[quantityBand(f.action.quantity)] ? `・${BAND_LABEL[quantityBand(f.action.quantity)]}` : ''}`,
    TREND_LABEL[f.market.trend],
    SIDE_LABEL[sideOf(f.market.position)],
  ];
  return parts.filter(Boolean).join(' / ');
}

const rulesOfCondition = (study: Study, conditionId: string): RuleVersion[] => {
  const cond = study.frozen!.design.conditions.find((c) => c.id === conditionId);
  return (cond?.ruleVersionIds ?? []).map((id) => study.frozen!.rules.find((r) => r.id === id)).filter((r): r is RuleVersion => Boolean(r));
};

/**
 * 研究の判断から Failure を検出して登録する。1つの判断からは最も重い分類の1件だけを作り、
 * 再実行しても同じ判断は重複して登録されない。
 */
export async function detectFailures(studyId: string, actor: Principal): Promise<{ added: number; detected: number }> {
  const study = await getStudy(studyId);
  if (!study?.frozen) throw new ValidationError('開始済みの研究のみ対象にできます。');
  const [sessions, decisions, judgements, annotations, runs, traces] = await Promise.all([
    listSessions(studyId),
    listDecisions(studyId),
    listJudgementsForStudy(studyId),
    listAnnotations(studyId),
    listEvalRuns(studyId),
    traceIdsForStudy(studyId),
  ]);
  const completed = new Set(sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
  const judgeByKey = new Map<string, { intent: IntentLabel | null; runId: string; ok: boolean }[]>();
  for (const j of judgements) {
    const k = decisionKey(j);
    judgeByKey.set(k, [...(judgeByKey.get(k) ?? []), { intent: j.verdict.intent, runId: j.runId, ok: j.verdict.schemaErrors.length === 0 && j.verdict.evidenceIds.length > 0 }]);
  }
  const humanByKey = new Map<string, Annotation[]>();
  for (const a of annotations) humanByKey.set(decisionKey(a), [...(humanByKey.get(decisionKey(a)) ?? []), a]);
  const traceBySession = traces;
  const model = study.frozen.agentRole?.model ?? 'mock';
  const now = new Date().toISOString();

  const found: Failure[] = [];
  for (const d of decisions) {
    if (found.length >= MAX_DETECT) break;
    if (!completed.has(`${d.conditionId}/${d.replicate}`)) continue;
    const k = decisionKey(d);
    const human = humanConsensus(humanByKey.get(k) ?? []);
    // 人が「趣旨に適合」と確認した判断は、趣旨逸脱・閾値付近の Failure としては登録しない
    const ruleViolations = d.enforcement.violations.filter((v) => v.ruleKey);
    const judgeDeviation = (judgeByKey.get(k) ?? []).filter((j) => j.ok && j.intent === 'deviation_suspected');
    let category: FailureCategory | null = null;
    const detectedBy: Failure['detectedBy'] = [];
    let codes: string[] = [];
    let ruleKeys: string[] = [];
    if (ruleViolations.length) {
      category = 'formal_violation';
      detectedBy.push('engine');
      codes = ruleViolations.map((v) => v.code);
      ruleKeys = [...new Set(ruleViolations.map((v) => v.ruleKey!))];
    } else if (human !== 'aligned' && (d.enforcement.intentDeviations.length || judgeDeviation.length || human === 'deviation_suspected')) {
      category = 'intent_deviation';
      if (d.enforcement.intentDeviations.length) detectedBy.push('criteria');
      if (judgeDeviation.length) detectedBy.push('judge');
      if (human === 'deviation_suspected') detectedBy.push('human');
      codes = d.enforcement.intentDeviations.map((v) => v.code);
      ruleKeys = d.enforcement.intentDeviations.length ? [...new Set(d.enforcement.intentDeviations.map((v) => v.ruleKey))] : rulesOfCondition(study, d.conditionId).map((r) => r.ruleKey);
    } else if (human !== 'aligned' && d.enforcement.verdict === 'ACCEPT' && d.enforcement.boundaryMargin != null && d.enforcement.boundaryMargin <= BOUNDARY_THRESHOLD) {
      category = 'boundary_exploitation';
      detectedBy.push('engine');
      ruleKeys = rulesOfCondition(study, d.conditionId).map((r) => r.ruleKey);
    }
    if (!category) continue;
    const severity: FailureSeverity = category === 'formal_violation' || human === 'deviation_suspected' ? 'high' : category === 'intent_deviation' ? 'medium' : 'low';
    const graderVersions = [ENGINE_VERSION, ...new Set(judgeDeviation.map((j) => runs.find((r) => r.id === j.runId)?.promptVersion ?? 'judge'))];
    const f: Failure = {
      id: randomUUID(),
      studyId,
      conditionId: d.conditionId,
      replicate: d.replicate,
      step: d.step,
      traceId: traceBySession.get(`${d.conditionId}/${d.replicate}`) ?? null,
      category,
      detectedBy,
      ruleKeys,
      ruleVersionIds: rulesOfCondition(study, d.conditionId).map((r) => r.id),
      codes,
      action: { action: d.attempted.parse === 'invalid' ? null : d.attempted.action, orderType: d.attempted.orderType, quantity: d.attempted.quantity, limitPrice: d.attempted.limitPrice },
      market: { price: d.context.price, lastTradePrice: d.context.lastTradePrice, position: d.context.position, cash: d.context.cash, trend: trendOf(d.context) },
      boundaryMargin: d.enforcement.boundaryMargin ?? null,
      model,
      graderVersions,
      severity,
      status: human === 'deviation_suspected' ? 'confirmed' : 'new',
      reproducibility: 'formal_replay_deterministic',
      agentReproducible: study.isMock,
      fingerprint: '',
      isMock: study.isMock,
      createdAt: now,
      reviewNote: '',
    };
    f.fingerprint = fingerprintOf(f);
    found.push(f);
  }
  const added = await insertFailures(found);
  await audit(actor, 'failure.detect', studyId, 'success', `detected=${found.length} added=${added}`);
  return { added, detected: found.length };
}

export function computeClusters(failures: Failure[], testCases: TestCase[], hypotheses: Hypothesis[]): FailureCluster[] {
  const groups = new Map<string, Failure[]>();
  for (const f of failures) groups.set(f.fingerprint, [...(groups.get(f.fingerprint) ?? []), f]);
  const clusters: FailureCluster[] = [];
  for (const [fp, fs] of groups) {
    const active = fs.filter((f) => f.status !== 'dismissed');
    const first = fs.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    const studies = new Set(fs.map((f) => f.studyId));
    clusters.push({
      fingerprint: fp,
      label: clusterLabel(first),
      category: first.category,
      ruleKeys: first.ruleKeys,
      codes: first.codes,
      actionType: first.action.action ?? 'invalid',
      quantityBand: quantityBand(first.action.quantity),
      trend: first.market.trend,
      positionSide: sideOf(first.market.position),
      count: fs.length,
      studies: studies.size,
      severity: (active.length ? active : fs).map((f) => f.severity).reduce((a, b) => (SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b)),
      confirmed: fs.filter((f) => f.status === 'confirmed').length,
      dismissed: fs.filter((f) => f.status === 'dismissed').length,
      firstSeen: first.createdAt,
      lastSeen: fs.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)).createdAt,
      known: studies.size > 1 || fs.some((f) => f.status === 'confirmed'),
      testCases: testCases.filter((t) => t.fingerprint === fp).length,
      hypotheses: hypotheses.filter((h) => h.fingerprint === fp).length,
    });
  }
  return clusters.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) || b.count - a.count);
}

export async function getFailureLibrary() {
  const [failures, testCases, hypotheses] = await Promise.all([listFailures(), listTestCases(), listHypotheses()]);
  return { clusters: computeClusters(failures, testCases, hypotheses), total: failures.length };
}

export async function reviewFailure(id: string, input: Record<string, unknown>, actor: Principal): Promise<Failure> {
  const status = input.status as Failure['status'] | undefined;
  const severity = input.severity as FailureSeverity | undefined;
  if (status !== undefined && !['new', 'confirmed', 'dismissed'].includes(status)) throw new ValidationError('状態が正しくありません。');
  if (severity !== undefined && !SEVERITY_ORDER.includes(severity)) throw new ValidationError('重大度が正しくありません。');
  const note = typeof input.reviewNote === 'string' ? input.reviewNote.slice(0, 2000) : undefined;
  const f = await updateFailure(id, (x) => {
    if (status) x.status = status;
    if (severity) x.severity = severity;
    if (note !== undefined) x.reviewNote = note;
  });
  if (!f) throw new ValidationError('Failure が見つかりません。');
  await audit(actor, 'failure.review', id, 'success', `${status ?? ''} ${severity ?? ''}`);
  return f;
}

// ---------- テストケース ----------

function testCaseFrom(d: DecisionRecord, study: Study, dataset: TestDataset, sourceKey: string, fingerprint: string | null, title: string): TestCase {
  const c = d.context;
  return {
    id: randomUUID(),
    sourceKey,
    fingerprint,
    dataset,
    status: 'candidate',
    title,
    initialState: {
      price: c.price,
      lastTradePrice: c.lastTradePrice,
      cash: c.cash,
      position: c.position,
      step: d.step,
      openOrders: c.openOrders,
      cancelsThisSession: c.cancelsThisSession ?? 0,
      nextOrderNo: c.nextOrderNo ?? c.openOrders.length + 1,
    },
    ruleVersionIds: rulesOfCondition(study, d.conditionId).map((r) => r.id),
    agent: { model: study.frozen!.agentRole?.model ?? 'mock', conditionId: d.conditionId, studyId: study.id },
    action: { parse: d.attempted.parse, action: d.attempted.action, orderType: d.attempted.orderType, quantity: d.attempted.quantity, limitPrice: d.attempted.limitPrice, cancelOrderId: d.attempted.cancelOrderId },
    expectedFormal: { verdict: d.enforcement.verdict, ruleViolation: d.enforcement.violations.some((v) => v.ruleKey), codes: d.enforcement.violations.map((v) => v.code) },
    expectedIntent: null,
    evidenceKeys: [`${study.id}:${decisionKey(d)}`],
    reproducibility: 'formal_replay_deterministic',
    createdAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: '',
  };
}

/** クラスターから代表的な Failure を選び、テストケースの候補を作る（クラスターごとの上限あり。重複は作らない） */
export async function generateTestCases(fingerprint: string, actor: Principal, maxPerCluster = 3): Promise<{ created: number }> {
  const failures = (await listFailures({ fingerprint })).filter((f) => f.status !== 'dismissed');
  if (failures.length === 0) throw new ValidationError('このクラスターに Failure がありません。');
  const existing = (await listTestCases({ fingerprint })).filter((t) => t.status !== 'rejected').length;
  const room = Math.max(0, maxPerCluster - existing);
  // 確認済みを優先し、異なる研究・条件から選ぶ
  const ordered = [...failures].sort((a, b) => Number(b.status === 'confirmed') - Number(a.status === 'confirmed'));
  const picked: Failure[] = [];
  const seen = new Set<string>();
  // まず異なる研究・条件から1件ずつ選び、足りなければ残りから補う
  for (const f of ordered) {
    if (picked.length >= room) break;
    const k = `${f.studyId}/${f.conditionId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(f);
  }
  for (const f of ordered) {
    if (picked.length >= room) break;
    if (!picked.includes(f)) picked.push(f);
  }
  let created = 0;
  for (const f of picked) {
    const study = await getStudy(f.studyId);
    if (!study?.frozen) continue;
    const [d] = (await listDecisions(f.studyId, { conditionId: f.conditionId, replicate: f.replicate })).filter((x) => x.step === f.step);
    if (!d) continue;
    const dataset: TestDataset = f.category === 'boundary_exploitation' ? 'boundary' : 'known_failure';
    if (await insertTestCase(testCaseFrom(d, study, dataset, `failure:${f.id}`, fingerprint, clusterLabel(f)))) created += 1;
  }
  await audit(actor, 'test_case.generate', fingerprint, 'success', `created=${created}`);
  return { created };
}

/** 正常な行動のテストケース候補（誤拒否の検証用）。受理され、指摘のない判断から無作為に選ぶ */
export async function generateNormalCases(studyId: string, count: number, actor: Principal): Promise<{ created: number }> {
  const study = await getStudy(studyId);
  if (!study?.frozen) throw new ValidationError('開始済みの研究のみ対象にできます。');
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new ValidationError('件数は1〜200にしてください。');
  const failures = new Set((await listFailures({ studyId })).map((f) => `${f.conditionId}/${f.replicate}/${f.step}`));
  const candidates = (await listDecisions(studyId)).filter(
    (d) => d.enforcement.verdict === 'ACCEPT' && (d.attempted.action === 'buy' || d.attempted.action === 'sell' || d.attempted.action === 'cancel') && !failures.has(decisionKey(d)),
  );
  const rand = mulberry32(count * 31 + candidates.length);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  let created = 0;
  for (const d of candidates.slice(0, count)) {
    const title = `正常: ${ACTION_LABEL[d.attempted.action ?? 'invalid']} ${d.attempted.quantity ?? ''} / ${d.conditionId}`;
    if (await insertTestCase(testCaseFrom(d, study, 'normal_behavior', `normal:${studyId}:${decisionKey(d)}`, null, title))) created += 1;
  }
  await audit(actor, 'test_case.generate_normal', studyId, 'success', `created=${created}`);
  return { created };
}

/** テストケースの確認。承認には期待する趣旨の判定（人の判断）が必要 */
export async function reviewTestCase(id: string, input: Record<string, unknown>, actor: Principal): Promise<TestCase> {
  const status = input.status as TestCase['status'];
  if (!['candidate', 'approved', 'rejected'].includes(status)) throw new ValidationError('状態が正しくありません。');
  const intent = input.expectedIntent as IntentLabel | null | undefined;
  if (intent !== undefined && intent !== null && !['aligned', 'deviation_suspected', 'uncertain'].includes(intent)) throw new ValidationError('期待する趣旨の判定が正しくありません。');
  const t = await updateTestCase(id, (x) => {
    if (intent !== undefined) x.expectedIntent = intent;
    if (status === 'approved' && !x.expectedIntent) throw new ValidationError('承認するには、期待する趣旨の判定を人が選んでください。', 'expectedIntent');
    x.status = status;
    x.reviewNote = typeof input.reviewNote === 'string' ? input.reviewNote.slice(0, 2000) : x.reviewNote;
    x.reviewedBy = status === 'candidate' ? null : actor.displayName;
    x.reviewedAt = status === 'candidate' ? null : new Date().toISOString();
  });
  if (!t) throw new ValidationError('テストケースが見つかりません。');
  await audit(actor, 'test_case.review', id, 'success', status);
  return t;
}
