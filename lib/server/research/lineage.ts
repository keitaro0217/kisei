import type { Failure, Hypothesis, TestCase } from '@/lib/research/failure-types';
import type { Patch, RegressionRun } from '@/lib/research/patch-types';
import { listFailures, listHypotheses, listTestCases } from '../storage/failureStore';
import { listPatches, listRegressionRuns } from '../storage/patchStore';
import { listAuditByTargets } from '../storage/store';
import { getStudy } from '../storage/studyStore';

// 問題（Failure のクラスター）を起点に、発見から改善の検証までの全履歴をたどる。
// 発見（研究・トレース）→ 人の確認 → 原因仮説 → 比較実験による検証 → 修正案 → 承認 → 回帰テスト → 再実験。
// 各段階は保存済みのデータ（研究結果・判断の記録・監査ログ）から組み立て、推測で埋めない。

export type LineageStage = 'detected' | 'reviewed' | 'test_cases' | 'hypothesized' | 'hypothesis_tested' | 'patched' | 'approved' | 'regression_tested' | 'reexperimented' | 'recommended';

export type LineageEvent = { at: string; stage: LineageStage | 'audit'; title: string; detail: string | null; href: string | null; by: string | null };

export type Lineage = {
  fingerprint: string;
  summary: {
    failures: number;
    studies: { id: string; title: string; isMock: boolean }[];
    confirmed: number;
    dismissed: number;
    testCases: { approved: number; candidate: number };
    hypotheses: { total: number; tested: number; supported: number };
    patches: { total: number; approved: number; recommended: number };
    regression: { runs: number; pass: number; latestGate: RegressionRun['gate'] | null };
    reexperiments: number;
  };
  stages: { stage: LineageStage; label: string; done: boolean }[];
  /** 改善の検証まで完了したか（回帰テストが PASS し、再実験の結果がある） */
  verified: boolean;
  /** モックのデータを含むか（研究結果として扱わない） */
  includesMock: boolean;
  events: LineageEvent[];
};

const STAGE_LABELS: Record<LineageStage, string> = {
  detected: '発見',
  reviewed: '人による確認',
  test_cases: 'テストケース化',
  hypothesized: '原因仮説',
  hypothesis_tested: '比較実験による仮説の検証',
  patched: '修正案',
  approved: '修正案の承認',
  regression_tested: '回帰テスト',
  reexperimented: '再実験（修正前後の比較）',
  recommended: '提案として承認',
};

const SUPPORTED = new Set(['EVIDENCE_SUPPORTS_EFFECT']);
const TESTED = new Set(['EXPERIMENT_TESTED', 'EVIDENCE_SUPPORTS_EFFECT', 'EVIDENCE_INCONCLUSIVE', 'EVIDENCE_AGAINST_EFFECT']);
const APPROVED = new Set(['approved_for_simulation', 'simulation_completed', 'approved_for_recommendation']);

export async function issueLineage(fingerprint: string): Promise<Lineage | null> {
  const failures: Failure[] = await listFailures({ fingerprint, limit: 5000 });
  if (failures.length === 0) return null;
  const [testCases, hypotheses, allPatches]: [TestCase[], Hypothesis[], Patch[]] = await Promise.all([listTestCases({ fingerprint }), listHypotheses(fingerprint), listPatches()]);
  const hypIds = new Set(hypotheses.map((h) => h.id));
  const patches = allPatches.filter((p) => p.relatedFingerprint === fingerprint || (p.relatedHypothesisId && hypIds.has(p.relatedHypothesisId)));
  const runs = (await Promise.all(patches.map((p) => listRegressionRuns(p.id)))).flat();
  const studyIds = [...new Set([...failures.map((f) => f.studyId), ...hypotheses.map((h) => h.experimentStudyId), ...patches.map((p) => p.experimentStudyId)].filter((x): x is string => Boolean(x)))];
  const studies = (await Promise.all(studyIds.map((id) => getStudy(id)))).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const studyTitle = (id: string | null) => studies.find((s) => s.id === id)?.design.title ?? id ?? '—';

  const events: LineageEvent[] = [];
  // 発見: 研究ごとに最初の検出
  const byStudy = new Map<string, Failure[]>();
  for (const f of failures) byStudy.set(f.studyId, [...(byStudy.get(f.studyId) ?? []), f]);
  for (const [sid, fs] of byStudy) {
    const first = fs.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    events.push({ at: first.createdAt, stage: 'detected', title: `研究「${studyTitle(sid)}」で ${fs.length} 件検出`, detail: `検出方法: ${[...new Set(fs.flatMap((f) => f.detectedBy))].join(', ')}`, href: `/research/studies/${sid}?condition=${encodeURIComponent(first.conditionId)}&replicate=${first.replicate}&step=${first.step}`, by: null });
  }
  for (const t of testCases) events.push({ at: t.createdAt, stage: 'test_cases', title: `テストケース「${t.title}」（${t.status === 'approved' ? '承認済み' : t.status === 'rejected' ? '却下' : '候補'}）`, detail: null, href: '/research/test-cases', by: null });
  for (const h of hypotheses) {
    events.push({ at: h.createdAt, stage: 'hypothesized', title: `原因仮説「${h.title}」`, detail: h.description, href: `/research/hypotheses/${h.id}`, by: null });
    for (const st of h.history.filter((x) => TESTED.has(x.status))) {
      events.push({ at: st.at, stage: 'hypothesis_tested', title: `仮説の検証: ${st.status}`, detail: st.note || null, href: h.experimentStudyId ? `/research/studies/${h.experimentStudyId}` : `/research/hypotheses/${h.id}`, by: st.by });
    }
  }
  for (const p of patches) {
    events.push({ at: p.createdAt, stage: 'patched', title: `修正案「${p.title}」`, detail: p.reason, href: `/research/patches/${p.id}`, by: p.createdBy });
    for (const r of p.reviews) {
      const stage: LineageStage = r.to === 'approved_for_recommendation' ? 'recommended' : APPROVED.has(r.to) ? 'approved' : 'patched';
      events.push({ at: r.at, stage, title: `修正案の状態: ${r.from} → ${r.to}`, detail: r.note || null, href: `/research/patches/${p.id}`, by: r.by });
    }
  }
  for (const r of runs) {
    events.push({ at: r.createdAt, stage: 'regression_tested', title: `回帰テスト: ${r.gate}`, detail: r.gateReasons.join(' / ') || null, href: `/research/patches/${r.patchId}`, by: r.createdBy });
    if (r.experiment) {
      events.push({
        at: r.createdAt,
        stage: 'reexperimented',
        title: `再実験: 違反率 ${fmt(r.experiment.violationRate.control)} → ${fmt(r.experiment.violationRate.treatment)}`,
        detail: `平均損益 ${fmtN(r.experiment.meanPnl.control)} → ${fmtN(r.experiment.meanPnl.treatment)}（副作用の確認）${r.experiment.isMock ? '・モック' : ''}`,
        href: `/research/studies/${r.experiment.studyId}`,
        by: null,
      });
    }
  }
  // 人による確認と、その他の操作（監査ログ）
  const audits = await listAuditByTargets([fingerprint, ...failures.slice(0, 400).map((f) => f.id), ...hypotheses.map((h) => h.id), ...patches.map((p) => p.id)]);
  for (const a of audits) {
    const stage = a.action.startsWith('failure.review') ? 'reviewed' : 'audit';
    events.push({ at: a.at, stage, title: a.action, detail: a.detail ?? null, href: null, by: a.actor });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const confirmed = failures.filter((f) => f.status === 'confirmed').length;
  const dismissed = failures.filter((f) => f.status === 'dismissed').length;
  const passRuns = runs.filter((r) => r.gate === 'PASS');
  const done: Record<LineageStage, boolean> = {
    detected: true,
    reviewed: confirmed + dismissed > 0,
    test_cases: testCases.some((t) => t.status === 'approved'),
    hypothesized: hypotheses.length > 0,
    hypothesis_tested: hypotheses.some((h) => TESTED.has(h.status)),
    patched: patches.length > 0,
    approved: patches.some((p) => APPROVED.has(p.status)),
    regression_tested: runs.length > 0,
    reexperimented: runs.some((r) => r.experiment !== null),
    recommended: patches.some((p) => p.status === 'approved_for_recommendation'),
  };
  const latest = runs.reduce<RegressionRun | null>((a, b) => (!a || b.createdAt > a.createdAt ? b : a), null);
  return {
    fingerprint,
    summary: {
      failures: failures.length,
      studies: studies.filter((s) => byStudy.has(s.id)).map((s) => ({ id: s.id, title: s.design.title, isMock: s.isMock })),
      confirmed,
      dismissed,
      testCases: { approved: testCases.filter((t) => t.status === 'approved').length, candidate: testCases.filter((t) => t.status === 'candidate').length },
      hypotheses: { total: hypotheses.length, tested: hypotheses.filter((h) => TESTED.has(h.status)).length, supported: hypotheses.filter((h) => SUPPORTED.has(h.status)).length },
      patches: { total: patches.length, approved: patches.filter((p) => APPROVED.has(p.status)).length, recommended: patches.filter((p) => p.status === 'approved_for_recommendation').length },
      regression: { runs: runs.length, pass: passRuns.length, latestGate: latest?.gate ?? null },
      reexperiments: runs.filter((r) => r.experiment).length,
    },
    stages: (Object.keys(STAGE_LABELS) as LineageStage[]).map((stage) => ({ stage, label: STAGE_LABELS[stage], done: done[stage] })),
    verified: passRuns.some((r) => r.experiment !== null),
    includesMock: failures.some((f) => f.isMock) || runs.some((r) => r.experiment?.isMock) || patches.some((p) => p.isMock),
    events,
  };
}

const fmt = (p: number | null) => (p === null ? '—' : `${(p * 100).toFixed(1)}%`);
const fmtN = (x: number | null) => (x === null ? '—' : x.toFixed(0));
