import { randomUUID } from 'node:crypto';
import type { ExpertFinding, PocMetrics, PocProject, TimeEntry } from '@/lib/research/poc-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth';
import { getDb } from '../../db';
import { listFailures } from '../../storage/failureStore';
import { listPatches, listRegressionRuns } from '../../storage/patchStore';
import { getStudy, listSessions } from '../../storage/studyStore';
import { traceIdsForStudy } from '../../storage/traceStore';
import { ValidationError } from '../providers';
import { LEGAL_DISCLAIMER, toCsv } from '../study/exports';

// PoC の価値測定（作業時間・新規リスク検出・修正案の有効性・副作用・監査可能性）。
// - 時間は人が入力した値（実測／推定を区別）を使い、推定値は推定として表示する。
// - 専門家が確認していない疑いは、確定した新規発見として数えない。
// - 架空の成果を実測値として表示しない（入力がなければ空欄のまま）。

const json = (v: unknown) => JSON.stringify(v);

async function save(p: PocProject) {
  const db = await getDb();
  await db.query(
    `INSERT INTO rc_poc (id, created_at, data) VALUES ($1, $2, $3::text::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [p.id, p.createdAt, json(p)],
  );
}

export async function listPocs(): Promise<PocProject[]> {
  const db = await getDb();
  return (await db.query<{ data: PocProject }>('SELECT data FROM rc_poc ORDER BY created_at DESC')).map((r) => r.data);
}

export async function getPoc(id: string): Promise<PocProject | null> {
  const db = await getDb();
  return (await db.query<{ data: PocProject }>('SELECT data FROM rc_poc WHERE id = $1', [id]))[0]?.data ?? null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function createPoc(input: Record<string, unknown>, actor: Principal): Promise<PocProject> {
  const name = text(input.name, 120);
  if (!name) throw new ValidationError('PoC の名称を入力してください。', 'name');
  const now = new Date().toISOString();
  const p: PocProject = {
    id: randomUUID(),
    name,
    purpose: text(input.purpose, 2000),
    comparisonTargets: text(input.comparisonTargets, 2000) || '従来のルールチェッカー（形式判定のみ）・人の専門家・kisei',
    studyIds: [],
    timeEntries: [],
    findings: [],
    limitations: '',
    remainingIssues: '',
    createdAt: now,
    createdBy: actor.displayName,
    updatedAt: now,
  };
  await save(p);
  await audit(actor, 'poc.create', p.id, 'success');
  return p;
}

const ACTIVITIES: TimeEntry['activity'][] = ['risk_review', 'patch_drafting', 'reverification', 'reporting', 'other'];

/** PoC の更新（基本情報・対象の研究・時間の記録・比較表）。操作ごとに検証する */
export async function updatePoc(id: string, input: Record<string, unknown>, actor: Principal): Promise<PocProject> {
  const p = await getPoc(id);
  if (!p) throw new ValidationError('PoC が見つかりません。');
  const op = input.op;
  if (op === 'info') {
    for (const k of ['purpose', 'comparisonTargets', 'limitations', 'remainingIssues'] as const) if (input[k] !== undefined) p[k] = text(input[k], 4000);
    if (input.name !== undefined) p.name = text(input.name, 120) || p.name;
  } else if (op === 'link_study') {
    const sid = text(input.studyId, 80);
    if (!(await getStudy(sid))?.frozen) throw new ValidationError('開始済みの研究を選んでください。');
    if (!p.studyIds.includes(sid)) p.studyIds.push(sid);
  } else if (op === 'unlink_study') {
    p.studyIds = p.studyIds.filter((s) => s !== input.studyId);
  } else if (op === 'add_time') {
    const minutes = Number(input.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 100_000) throw new ValidationError('時間（分）は0より大きい数値で入力してください。', 'minutes');
    if (input.phase !== 'baseline' && input.phase !== 'human') throw new ValidationError('区分が正しくありません。');
    if (!ACTIVITIES.includes(input.activity as TimeEntry['activity'])) throw new ValidationError('作業の種類が正しくありません。');
    if (input.kind !== 'measured' && input.kind !== 'estimated') throw new ValidationError('実測か推定かを選んでください。', 'kind');
    p.timeEntries.push({ id: randomUUID(), phase: input.phase, activity: input.activity as TimeEntry['activity'], minutes, kind: input.kind, note: text(input.note, 500), at: new Date().toISOString(), by: actor.displayName });
  } else if (op === 'remove_time') {
    p.timeEntries = p.timeEntries.filter((t) => t.id !== input.entryId);
  } else if (op === 'upsert_finding') {
    const f = input.finding as Partial<ExpertFinding> | undefined;
    const title = text(f?.title, 300);
    if (!title) throw new ValidationError('発見の内容を入力してください。');
    const tri = (v: unknown) => (v === true ? true : v === false ? false : null);
    const review = ['confirmed', 'false_positive', 'unreviewed'].includes(f?.expertReview as string) ? (f!.expertReview as ExpertFinding['expertReview']) : 'unreviewed';
    const next: ExpertFinding = {
      id: typeof f?.id === 'string' && f.id ? f.id : randomUUID(),
      title,
      fingerprint: typeof f?.fingerprint === 'string' && /^[0-9a-f]{16}$/.test(f.fingerprint) ? f.fingerprint : null,
      foundByRuleChecker: tri(f?.foundByRuleChecker),
      foundByExpert: tri(f?.foundByExpert),
      foundByKisei: f?.foundByKisei === true,
      expertReview: review,
      severity: ['low', 'medium', 'high'].includes(f?.severity as string) ? (f!.severity as ExpertFinding['severity']) : null,
      note: text(f?.note, 1000),
    };
    p.findings = [...p.findings.filter((x) => x.id !== next.id), next];
  } else if (op === 'remove_finding') {
    p.findings = p.findings.filter((x) => x.id !== input.findingId);
  } else {
    throw new ValidationError('操作が正しくありません。');
  }
  p.updatedAt = new Date().toISOString();
  await save(p);
  await audit(actor, `poc.${String(op)}`, id, 'success');
  return p;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export async function computePocMetrics(p: PocProject): Promise<PocMetrics> {
  const notices: string[] = [];
  // ---- 時間 ----
  const sum = (phase: TimeEntry['phase']) => p.timeEntries.filter((t) => t.phase === phase).reduce((a, t) => a + t.minutes, 0);
  const byActivity: PocMetrics['time']['byActivity'] = {};
  for (const t of p.timeEntries) {
    byActivity[t.activity] ??= { baseline: 0, human: 0 };
    byActivity[t.activity][t.phase] += t.minutes;
  }
  let systemMinutes = 0;
  // ---- 研究データ ----
  const failures = (await Promise.all(p.studyIds.map((s) => listFailures({ studyId: s })))).flat();
  let sessionsCompleted = 0;
  let traced = 0;
  let reproducible = 0;
  let mock = false;
  for (const sid of p.studyIds) {
    const study = await getStudy(sid);
    if (!study) continue;
    mock ||= study.isMock;
    if (study.frozenHash && (study.isMock || (study.frozen?.codeVersion && study.frozen.codeVersion !== 'local'))) reproducible += 1;
    const sessions = (await listSessions(sid)).filter((s) => s.status === 'completed');
    const traces = await traceIdsForStudy(sid);
    sessionsCompleted += sessions.length;
    traced += sessions.filter((s) => traces.has(`${s.conditionId}/${s.replicate}`)).length;
    systemMinutes += sessions.reduce((a, s) => a + (s.startedAt && s.finishedAt ? (Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60_000 : 0), 0);
  }
  if (mock) notices.push('【モックデータ】対象の研究にモックエージェントの研究が含まれます。検出・修正案の数値は研究フローの検証用であり、AIの行動に関する成果ではありません。');
  if (p.timeEntries.some((t) => t.kind === 'estimated')) notices.push('作業時間に推定値が含まれます（実測値ではありません）。');
  if (p.timeEntries.length === 0) notices.push('作業時間が入力されていないため、時間削減は算出していません。');

  // ---- 検出 ----
  const clusters = new Map<string, typeof failures>();
  for (const f of failures) clusters.set(f.fingerprint, [...(clusters.get(f.fingerprint) ?? []), f]);
  const confirmedClusters = [...clusters.entries()].filter(([, fs]) => fs.some((f) => f.status === 'confirmed'));
  const confirmedFp = new Set(confirmedClusters.map(([fp]) => fp));
  const tableConfirmed = p.findings.filter((f) => f.expertReview === 'confirmed' && !(f.fingerprint && confirmedFp.has(f.fingerprint)));
  const confirmedFindings = confirmedClusters.length + tableConfirmed.length;
  const novelFromClusters = confirmedClusters.filter(([, fs]) => fs[0].category !== 'formal_violation').length;
  const novelFromTable = tableConfirmed.filter((f) => f.foundByKisei && f.foundByRuleChecker === false && f.foundByExpert !== true).length;
  const falseNegatives = p.findings.filter((f) => f.expertReview === 'confirmed' && !f.foundByKisei).length;
  const falsePositives = failures.filter((f) => f.status === 'dismissed').length + p.findings.filter((f) => f.expertReview === 'false_positive' && f.foundByKisei).length;
  const unreviewedClusters = [...clusters.values()].filter((fs) => fs.every((f) => f.status === 'new')).length;
  const kiseiConfirmed = confirmedClusters.length + tableConfirmed.filter((f) => f.foundByKisei).length;

  // ---- 修正案 ----
  const fps = new Set(clusters.keys());
  const patches = (await listPatches()).filter((x) => x.relatedFingerprint && fps.has(x.relatedFingerprint));
  const runs = await listRegressionRuns();
  const latest = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latest.has(r.patchId)) latest.set(r.patchId, r);
  const reviewMinutes = patches.flatMap((x) => {
    const start = x.reviews.find((r) => r.to === 'under_review');
    const decided = x.reviews.find((r) => r.from === 'under_review' && r.to !== 'draft');
    return start && decided ? [(Date.parse(decided.at) - Date.parse(start.at)) / 60_000] : [];
  });
  const patchRuns = patches.map((x) => latest.get(x.id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const fri = patchRuns.map((r) => r.metrics.falseRejectionIncrease).filter((v): v is number => v !== null);
  const exps = patchRuns.map((r) => r.experiment).filter((e): e is NonNullable<typeof e> => Boolean(e));

  return {
    dataNotice: notices,
    time: {
      baselineMinutes: sum('baseline'),
      humanMinutes: sum('human'),
      systemMinutes,
      savedMinutes: p.timeEntries.some((t) => t.phase === 'baseline') && p.timeEntries.some((t) => t.phase === 'human') ? sum('baseline') - sum('human') : null,
      baselineEstimated: p.timeEntries.some((t) => t.phase === 'baseline' && t.kind === 'estimated'),
      humanEstimated: p.timeEntries.some((t) => t.phase === 'human' && t.kind === 'estimated'),
      byActivity,
    },
    detection: {
      confirmedFindings,
      novelFindings: novelFromClusters + novelFromTable,
      falsePositives,
      falseNegatives,
      unreviewed: unreviewedClusters + p.findings.filter((f) => f.expertReview === 'unreviewed').length,
      detectionCoverage: confirmedFindings + falseNegatives > 0 ? kiseiConfirmed / (confirmedFindings + falseNegatives) : null,
      clusters: clusters.size,
    },
    patches: {
      generated: patches.length,
      expertValid: patches.filter((x) => ['approved_for_simulation', 'simulation_completed', 'approved_for_recommendation'].includes(x.status)).length,
      recommended: patches.filter((x) => x.status === 'approved_for_recommendation').length,
      reverified: patchRuns.filter((r) => r.experiment).length,
      regressionPassed: patchRuns.filter((r) => r.gate === 'PASS').length,
      medianReviewMinutes: median(reviewMinutes),
    },
    sideEffects: {
      meanFalseRejectionIncrease: mean(fri),
      newFailures: patchRuns.reduce((a, r) => a + r.metrics.newFailures, 0),
      meanLatencyIncreaseSeconds: mean(exps.filter((e) => e.meanSessionSeconds.control !== null && e.meanSessionSeconds.treatment !== null).map((e) => e.meanSessionSeconds.treatment! - e.meanSessionSeconds.control!)),
      costIncreaseUsd: exps.length ? exps.reduce((a, e) => a + e.costUsd.treatment - e.costUsd.control, 0) : null,
    },
    auditability: {
      evidenceLinkedRate: failures.length ? failures.filter((f) => f.traceId).length / failures.length : null,
      reproducibleRate: p.studyIds.length ? reproducible / p.studyIds.length : null,
      traceableRate: sessionsCompleted ? traced / sessionsCompleted : null,
      approvalRecordedRate: patches.length ? patches.filter((x) => x.status === 'draft' || x.reviews.length > 0).length / patches.length : null,
      unrecordedSessions: sessionsCompleted - traced,
    },
  };
}

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const mins = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)} 分`);

export function pocMarkdown(p: PocProject, m: PocMetrics, studies: { id: string; title: string; isMock: boolean; frozenHash: string | null }[]): string {
  const L: string[] = [];
  L.push(`# PoC 評価レポート: ${p.name}`, '');
  for (const n of m.dataNotice) L.push(`> ${n}`);
  if (m.dataNotice.length) L.push('');
  L.push('## 1. 検証目的', '', p.purpose || '（未記入）', '');
  L.push('## 2. 比較対象', '', p.comparisonTargets, '');
  L.push('## 3. 実験条件', '');
  for (const s of studies) L.push(`- ${s.title}${s.isMock ? '（モック）' : ''}・凍結ハッシュ \`${s.frozenHash ?? '—'}\``);
  if (!studies.length) L.push('（対象の研究がありません）');
  L.push('', '## 4. 使用データ', '', `対象の研究 ${studies.length} 件の意思決定ログ・トレース・Failure・修正案・回帰テストの記録。`, '');
  L.push('## 5. 検出された問題', '');
  L.push(`- 専門家が確認した発見: ${m.detection.confirmedFindings} 件（うち従来のルールチェッカーで検出できないもの: ${m.detection.novelFindings} 件）`);
  L.push(`- 誤検出: ${m.detection.falsePositives} 件・見逃し（専門家のみが発見）: ${m.detection.falseNegatives} 件・未確認の疑い: ${m.detection.unreviewed} 件（発見としては数えていません）`);
  L.push(`- 検出の網羅率: ${pct(m.detection.detectionCoverage)}`, '');
  L.push('## 6. 重大度と証拠', '');
  for (const f of p.findings) L.push(`- ${f.title}（重大度: ${f.severity ?? '未設定'}、専門家の確認: ${f.expertReview}）${f.note ? ` — ${f.note}` : ''}`);
  L.push(`- 証拠（トレース）付きの Failure の割合: ${pct(m.auditability.evidenceLinkedRate)}`, '');
  L.push('## 7. 修正案', '', `作成 ${m.patches.generated} 件・実験への使用を承認 ${m.patches.expertValid} 件・提案として承認 ${m.patches.recommended} 件・再実験 ${m.patches.reverified} 件・回帰テスト PASS ${m.patches.regressionPassed} 件・レビュー時間の中央値 ${mins(m.patches.medianReviewMinutes)}`, '');
  L.push('## 8. 改善効果と 9. 副作用', '', `誤拒否率の増加（平均）: ${m.sideEffects.meanFalseRejectionIncrease === null ? '—' : `${(m.sideEffects.meanFalseRejectionIncrease * 100).toFixed(1)} pt`}・新たな失敗: ${m.sideEffects.newFailures} 件・セッション時間の増加: ${m.sideEffects.meanLatencyIncreaseSeconds === null ? '—' : `${m.sideEffects.meanLatencyIncreaseSeconds.toFixed(2)} 秒`}・費用の増加: ${m.sideEffects.costIncreaseUsd === null ? '—' : `$${m.sideEffects.costIncreaseUsd.toFixed(4)}`}`, '');
  L.push('## 10. 費用・時間', '');
  L.push(`- 従来の作業時間: ${mins(m.time.baselineMinutes)}${m.time.baselineEstimated ? '（推定値を含む）' : ''}`);
  L.push(`- kisei 利用時の人の作業時間: ${mins(m.time.humanMinutes)}${m.time.humanEstimated ? '（推定値を含む）' : ''}`);
  L.push(`- システムの処理時間: ${mins(m.time.systemMinutes)}（人の作業時間とは別）`);
  L.push(`- 削減時間（従来 − 人の作業時間）: ${mins(m.time.savedMinutes)}`, '');
  L.push('## 11. 制約と不確実性', '', p.limitations || '（未記入）', '', `監査可能性: 再現可能な実験 ${pct(m.auditability.reproducibleRate)}・追跡可能なセッション ${pct(m.auditability.traceableRate)}・承認履歴の記録 ${pct(m.auditability.approvalRecordedRate)}・トレースのないセッション ${m.auditability.unrecordedSessions} 件`, '');
  L.push('## 12. 導入判断に必要な残課題', '', p.remainingIssues || '（未記入）', '');
  L.push('---', '', LEGAL_DISCLAIMER, '');
  return L.join('\n');
}

export function pocCsv(m: PocMetrics): string {
  const rows: [string, string, unknown][] = [
    ['time', 'baseline_minutes', m.time.baselineMinutes],
    ['time', 'human_minutes', m.time.humanMinutes],
    ['time', 'system_minutes', m.time.systemMinutes],
    ['time', 'saved_minutes', m.time.savedMinutes],
    ['time', 'baseline_estimated', m.time.baselineEstimated],
    ['detection', 'confirmed_findings', m.detection.confirmedFindings],
    ['detection', 'novel_findings', m.detection.novelFindings],
    ['detection', 'false_positives', m.detection.falsePositives],
    ['detection', 'false_negatives', m.detection.falseNegatives],
    ['detection', 'unreviewed', m.detection.unreviewed],
    ['detection', 'coverage', m.detection.detectionCoverage],
    ['patches', 'generated', m.patches.generated],
    ['patches', 'expert_valid', m.patches.expertValid],
    ['patches', 'recommended', m.patches.recommended],
    ['patches', 'reverified', m.patches.reverified],
    ['patches', 'regression_passed', m.patches.regressionPassed],
    ['side_effects', 'mean_false_rejection_increase', m.sideEffects.meanFalseRejectionIncrease],
    ['side_effects', 'new_failures', m.sideEffects.newFailures],
    ['auditability', 'evidence_linked_rate', m.auditability.evidenceLinkedRate],
    ['auditability', 'reproducible_rate', m.auditability.reproducibleRate],
    ['auditability', 'traceable_rate', m.auditability.traceableRate],
    ['auditability', 'unrecorded_sessions', m.auditability.unrecordedSessions],
  ];
  return toCsv(['section', 'metric', 'value'], rows.map((r) => r.map((v) => (v === null ? '' : v))));
}

