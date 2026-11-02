import { EVAL_CATEGORIES, itemKeyOf, type CompositeEvaluation, type EvalCategory, type EvaluationRecord, type GoldLabel, type LabelSetPurpose } from '@/lib/research/evaluation-model';
import type { Study } from '@/lib/research/study-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth/types';
import { listAnnotations, listEvalRuns, listJudgementsForStudy } from '../../storage/evalStore';
import { getStudy, listDecisions, listSessions } from '../../storage/studyStore';
import { freezeLabelSet, getLabelSet, insertLabelSet, insertReview, listLabels, listLabelSets, listReviews, upsertLabels } from '../../storage/validationStore';
import { ValidationError } from '../providers';
import { annotatorAgreement, biasChecks, compositeEvaluatorRef, compositePredictions, computeMetrics, formalAxisMetrics, goldConsensus, predictionsByEvaluator } from './validation';
import { AGGREGATION_VERSION, buildEvaluationRecords, compositeEvaluations } from './unified';

// 評価の統合（評価器ごとの判定・複合評価・人のレビュー）と、外部ラベルによる評価器の検証。

async function loadRecords(study: Study): Promise<{ records: EvaluationRecord[]; composites: CompositeEvaluation[] }> {
  const [sessions, decisions, runs, judgements, annotations, reviews] = await Promise.all([
    listSessions(study.id),
    listDecisions(study.id),
    listEvalRuns(study.id),
    listJudgementsForStudy(study.id),
    listAnnotations(study.id),
    listReviews(study.id),
  ]);
  // 完了したセッションの判断だけを評価の対象にする（途中のセッションはやり直されうる）
  const completed = new Set(sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
  const ds = decisions.filter((d) => completed.has(`${d.conditionId}/${d.replicate}`));
  const records = buildEvaluationRecords({ study, decisions: ds, runs, judgements, annotations, reviews });
  return { records, composites: compositeEvaluations(records) };
}

export async function getUnifiedEvaluation(studyId: string, opts: { limit?: number; onlyDisagreements?: boolean } = {}) {
  const study = await getStudy(studyId);
  if (!study?.frozen) throw new ValidationError('開始済みの研究のみ対象にできます。');
  const { records, composites } = await loadRecords(study);
  const evaluators = [...predictionsByEvaluator(records).values()].map(({ ref, preds }) => {
    const counts = Object.fromEntries(EVAL_CATEGORIES.map((c) => [c, 0])) as Record<EvalCategory, number>;
    for (const p of preds.values()) counts[p.category] += 1;
    return { evaluator: ref, evaluated: preds.size, counts };
  });
  const compositeCounts = Object.fromEntries(EVAL_CATEGORIES.map((c) => [c, 0])) as Record<EvalCategory, number>;
  for (const c of composites) compositeCounts[c.category] += 1;
  const byItem = new Map<string, EvaluationRecord[]>();
  for (const r of records) byItem.set(r.target.itemKey, [...(byItem.get(r.target.itemKey) ?? []), r]);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const items = composites
    .filter((c) => !opts.onlyDisagreements || c.disagreement || c.needsHumanReview)
    .sort((a, b) => Number(b.disagreement) - Number(a.disagreement) || Number(b.needsHumanReview) - Number(a.needsHumanReview))
    .slice(0, limit)
    .map((c) => ({ composite: c, evaluations: byItem.get(c.target.itemKey) ?? [] }));
  return {
    study: { id: study.id, title: study.design.title, isMock: study.isMock, generatorModel: study.frozen.agentRole?.model ?? null },
    aggregationVersion: AGGREGATION_VERSION,
    totals: { decisions: composites.length, disagreements: composites.filter((c) => c.disagreement).length, needsHumanReview: composites.filter((c) => c.needsHumanReview).length },
    composite: compositeCounts,
    evaluators,
    items,
  };
}

/** 評価器の判定を人が承認・修正・却下する（履歴は追記のみ） */
export async function reviewEvaluation(studyId: string, input: Record<string, unknown>, actor: Principal) {
  const study = await getStudy(studyId);
  if (!study?.frozen) throw new ValidationError('開始済みの研究のみ対象にできます。');
  const itemKey = String(input.itemKey ?? '');
  const evaluatorId = String(input.evaluatorId ?? '');
  const action = input.action;
  if (action !== 'approve' && action !== 'correct' && action !== 'reject') throw new ValidationError('レビューの操作（承認・修正・却下）を選んでください。', 'action');
  const correctedCategory = action === 'correct' ? String(input.correctedCategory ?? '') : null;
  if (action === 'correct' && !EVAL_CATEGORIES.includes(correctedCategory as EvalCategory)) throw new ValidationError('修正後のカテゴリを選んでください。', 'correctedCategory');
  const reviewer = typeof input.reviewer === 'string' ? input.reviewer.trim() : '';
  if (!reviewer || reviewer.length > 40) throw new ValidationError('レビューした人の名前を1〜40文字で入力してください。', 'reviewer');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) : '';
  if (action !== 'approve' && !note) throw new ValidationError('修正・却下の場合は理由を入力してください。', 'note');
  const { records } = await loadRecords(study);
  if (!records.some((r) => r.target.itemKey === itemKey && r.evaluator.id === evaluatorId)) throw new ValidationError('レビューする評価が見つかりません。');
  const saved = await insertReview({ studyId, itemKey, evaluatorId, action, correctedCategory: correctedCategory as EvalCategory | null, reviewer, note });
  await audit(actor, `evaluation.review.${action}`, `${studyId}:${itemKey}`, 'success', `${evaluatorId}${correctedCategory ? ` → ${correctedCategory}` : ''}`);
  return saved;
}

// ---------- ラベル付きデータセット ----------

export async function createLabelSet(input: Record<string, unknown>, actor: Principal) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) throw new ValidationError('データセットの名前を1〜80文字で入力してください。', 'name');
  const purpose: LabelSetPurpose = input.purpose === 'evaluation_test' ? 'evaluation_test' : input.purpose === 'external_gold' ? 'external_gold' : (() => {
    throw new ValidationError('用途（評価器のテスト用 / 外部の正解ラベル）を選んでください。', 'purpose');
  })();
  const source = typeof input.source === 'string' ? input.source.trim().slice(0, 500) : '';
  if (!source) throw new ValidationError('ラベルの出典（誰が、どの基準で付けたか）を入力してください。', 'source');
  const set = await insertLabelSet({
    name,
    purpose,
    description: typeof input.description === 'string' ? input.description.slice(0, 2000) : '',
    source,
    guidelineVersion: typeof input.guidelineVersion === 'string' && input.guidelineVersion.trim() ? input.guidelineVersion.trim().slice(0, 40) : 'v1',
    createdBy: actor.displayName,
  });
  await audit(actor, 'label_set.create', set.id, 'success', `${name} v${set.version}`);
  return set;
}

/** ラベルの検証と登録。対象の判断が実在すること（参照整合性）を確かめる */
export async function addLabels(setId: string, input: Record<string, unknown>, actor: Principal) {
  const set = await getLabelSet(setId);
  if (!set) throw new ValidationError('データセットが見つかりません。');
  if (set.frozen) throw new ValidationError('固定したデータセットにはラベルを追加できません（新しい版を作成してください）。');
  const rows = Array.isArray(input.labels) ? input.labels : typeof input.csv === 'string' ? parseCsv(input.csv) : null;
  if (!rows || rows.length === 0) throw new ValidationError('ラベルがありません（labels の配列、または CSV を指定してください）。', 'labels');
  if (rows.length > 5000) throw new ValidationError('一度に登録できるラベルは5,000件までです。', 'labels');
  const labels: Omit<GoldLabel, 'setId' | 'itemKey' | 'at'>[] = [];
  const decisionsByStudy = new Map<string, Set<string>>();
  for (const [i, raw] of rows.entries()) {
    const r = raw as Record<string, unknown>;
    const where = `${i + 1}行目`;
    const studyId = String(r.studyId ?? r.study_id ?? '');
    const conditionId = String(r.conditionId ?? r.condition_id ?? '');
    const replicate = Number(r.replicate);
    const step = Number(r.step);
    const annotator = String(r.annotator ?? '').trim();
    const category = String(r.category ?? '');
    const formalRaw = r.formal === undefined || r.formal === null || r.formal === '' ? null : String(r.formal);
    if (!studyId || !conditionId || !Number.isInteger(replicate) || !Number.isInteger(step)) throw new ValidationError(`${where}: 対象の判断（study_id, condition_id, replicate, step）が正しくありません。`);
    if (!annotator || annotator.length > 40) throw new ValidationError(`${where}: 評価者（annotator）を1〜40文字で指定してください。`);
    if (!EVAL_CATEGORIES.includes(category as EvalCategory)) throw new ValidationError(`${where}: category は ${EVAL_CATEGORIES.join(' / ')} のいずれかにしてください。`);
    if (formalRaw !== null && formalRaw !== 'compliant' && formalRaw !== 'violation') throw new ValidationError(`${where}: formal は compliant / violation / 空欄のいずれかにしてください。`);
    if (!decisionsByStudy.has(studyId)) {
      const st = await getStudy(studyId);
      if (!st) throw new ValidationError(`${where}: 研究 ${studyId} が見つかりません。`);
      decisionsByStudy.set(studyId, new Set((await listDecisions(studyId)).map((d) => `${d.conditionId}/${d.replicate}/${d.step}`)));
    }
    if (!decisionsByStudy.get(studyId)!.has(`${conditionId}/${replicate}/${step}`)) throw new ValidationError(`${where}: 対象の判断が研究に存在しません。`);
    labels.push({ target: { studyId, conditionId, replicate, step }, annotator, category: category as EvalCategory, formal: formalRaw as 'compliant' | 'violation' | null, note: String(r.note ?? '').slice(0, 1000) });
  }
  const n = await upsertLabels(setId, labels);
  await audit(actor, 'label_set.labels', setId, 'success', `n=${n}`);
  return { added: n };
}

/** CSV（ヘッダー行あり。列: study_id, condition_id, replicate, step, annotator, category, formal, note） */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

export async function freezeSet(setId: string, actor: Principal) {
  const ok = await freezeLabelSet(setId);
  if (!ok) throw new ValidationError('データセットが見つからないか、すでに固定されています。');
  await audit(actor, 'label_set.freeze', setId, 'success');
  return getLabelSet(setId);
}

/** 新しい版を作る（前の版のラベルを引き継ぐ。前の版は変更されない） */
export async function newVersion(setId: string, actor: Principal) {
  const prev = await getLabelSet(setId);
  if (!prev) throw new ValidationError('データセットが見つかりません。');
  const next = await insertLabelSet({ name: prev.name, purpose: prev.purpose, description: prev.description, source: prev.source, guidelineVersion: prev.guidelineVersion, createdBy: actor.displayName });
  const labels = await listLabels(setId);
  await upsertLabels(next.id, labels.map((l) => ({ target: l.target, annotator: l.annotator, category: l.category, formal: l.formal, note: l.note })));
  await audit(actor, 'label_set.new_version', next.id, 'success', `from ${prev.name} v${prev.version}`);
  return getLabelSet(next.id);
}

export { listLabelSets, getLabelSet, listLabels };

/** 評価器の検証: 正解ラベルに対する各評価器・複合評価の指標、形式の軸の指標、評価者間の一致、バイアスの検証 */
export async function validateLabelSet(setId: string) {
  const set = await getLabelSet(setId);
  if (!set) throw new ValidationError('データセットが見つかりません。');
  const labels = await listLabels(setId);
  const { gold, disputed, formal } = goldConsensus(labels);
  const studyIds = [...new Set(labels.map((l) => l.target.studyId))];
  const allRecords: EvaluationRecord[] = [];
  const allComposites: CompositeEvaluation[] = [];
  const studies: { id: string; title: string; isMock: boolean }[] = [];
  for (const id of studyIds) {
    const st = await getStudy(id);
    if (!st?.frozen) continue;
    studies.push({ id, title: st.design.title, isMock: st.isMock });
    const { records, composites } = await loadRecords(st);
    // 正解ラベルのある判断だけを対象にする
    const keys = new Set(labels.filter((l) => l.target.studyId === id).map((l) => itemKeyOf(l.target)));
    allRecords.push(...records.filter((r) => keys.has(r.target.itemKey)));
    allComposites.push(...composites.filter((c) => keys.has(c.target.itemKey)));
  }
  // 正解ラベルを付けた評価者自身の判定（human:...）は、同じ人のラベルと比べると循環するため指標から除く
  const labelAnnotators = new Set(labels.map((l) => `human:${l.annotator}`));
  const metrics = [...predictionsByEvaluator(allRecords).values()]
    .filter((e) => !labelAnnotators.has(e.ref.id))
    .map((e) => computeMetrics(e.ref, e.preds, gold, disputed.size));
  metrics.push(computeMetrics(compositeEvaluatorRef(), compositePredictions(allComposites), gold, disputed.size));
  const engineRecords = allRecords.filter((r) => r.evaluator.kind === 'deterministic');
  const formalMetrics = formal.size && engineRecords.length ? [formalAxisMetrics(engineRecords[0].evaluator, engineRecords, formal)] : [];
  return {
    set,
    studies,
    /** 評価器のテスト用データ（合成など）の場合、研究結果としては扱わない */
    isTestData: set.purpose === 'evaluation_test',
    includesMock: studies.some((s) => s.isMock),
    gold: { labeled: gold.size, disputed: disputed.size, annotators: set.annotators },
    metrics,
    formalMetrics,
    annotatorAgreement: annotatorAgreement(labels),
    bias: biasChecks(allRecords, gold, labels),
  };
}
