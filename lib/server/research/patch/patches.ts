import { randomUUID } from 'node:crypto';
import type { Failure } from '@/lib/research/failure-types';
import type { Patch, PatchCategory, PatchStatus, PresentationChange } from '@/lib/research/patch-types';
import type { RuleCondition, RuleDefinition, RuleVersion, StudyCondition } from '@/lib/research/study-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth';
import { getHypothesis, listFailures } from '../../storage/failureStore';
import { getPatch, insertPatch, listPatches, listRegressionRuns, updatePatch } from '../../storage/patchStore';
import { getRuleVersions, getStudy, listRulePairs } from '../../storage/studyStore';
import { contentHash } from '../../util/canonical';
import { ValidationError } from '../providers';
import { parseRuleDefinition, saveRuleVersion } from '../study/rules';
import { createStudy, startStudy } from '../study/studies';

// Auto-Patch: Failure と原因の候補から修正案を作り、研究者の承認を経て仮想環境でだけ検証する。
// - 修正案の生成はテンプレートによる決定論的な生成（この版では LLM による生成は行わない）。
// - 実験用の規則は元の規則とは別の規則 ID（<元の ID>-PATCH）で保存し、元の規則・実行中の研究・本番の業務には一切反映しない。
// - 「実験への使用の承認」と「企業への提案としての承認」を分ける。

export const PATCH_GENERATOR = 'kisei-template-v1';

const toDefinition = (r: RuleVersion): RuleDefinition => ({
  ruleKey: r.ruleKey,
  name: r.name,
  industry: r.industry,
  market: r.market,
  purpose: r.purpose,
  text: r.text,
  applicability: r.applicability,
  prohibitedActions: r.prohibitedActions,
  permittedActions: r.permittedActions,
  exceptions: r.exceptions,
  references: r.references,
  parameters: { ...r.parameters },
  checks: structuredClone(r.checks),
  intentCriteria: structuredClone(r.intentCriteria),
});

/** 判定式の中で「変数 比較 閾値」の形をしている閾値と、厳しくする方向 */
function thresholdDirections(cond: RuleCondition, out: Map<string, 'lower' | 'raise'>) {
  if ('all' in cond) cond.all.forEach((c) => thresholdDirections(c, out));
  else if ('any' in cond) cond.any.forEach((c) => thresholdDirections(c, out));
  else if ('cmp' in cond && 'param' in cond.right && 'var' in cond.left) {
    // 「値 >= 閾値」で違反なら、閾値を下げると厳しくなる。「値 <= 閾値」なら上げると厳しくなる
    if (cond.cmp === '>=' || cond.cmp === '>') out.set(cond.right.param, 'lower');
    if (cond.cmp === '<=' || cond.cmp === '<') out.set(cond.right.param, 'raise');
  }
}

type Draft = Pick<Patch, 'category' | 'title' | 'after' | 'presentation' | 'reason' | 'expectedImprovement' | 'expectedSideEffects'>;

export function draftPatches(rule: RuleVersion, cond: StudyCondition, failures: Failure[], counterpart: RuleVersion | null): Draft[] {
  const drafts: Draft[] = [];
  const base = toDefinition(rule);
  const category = failures[0]?.category ?? 'formal_violation';
  if (counterpart && /かつ|又は|または|新たに|新規|既存/.test(rule.text)) {
    const c = toDefinition(counterpart);
    drafts.push({
      category: 'regulatory_text',
      title: `文言を ${counterpart.ruleKey} v${counterpart.version} の形に変える`,
      after: { ...c, ruleKey: rule.ruleKey },
      presentation: null,
      reason: 'ミニマルペアの相手の条文（接続詞・限定語が異なる）と判定ロジックを採用します。',
      expectedImprovement: '条文の範囲の違いにより、該当する行動の受理・拒否が変わります。',
      expectedSideEffects: '範囲を広げる場合、正常な行動の誤拒否が増える可能性があります。',
    });
  }
  const paramList = Object.entries(rule.parameters);
  drafts.push({
    category: 'definition',
    title: paramList.length ? '用語の定義を条文に明記する' : '規制の趣旨を条文に明記する',
    after: {
      ...base,
      text: paramList.length
        ? `${rule.text}\n（定義）${paramList.map(([k, v]) => `${k} は ${v} とする`).join('。')}。この規定の趣旨（${rule.purpose || '公正な取引の確保'}）に反する行為も、これに準じて扱う。`
        : `${rule.text}\n本規定は「${rule.purpose || '公正な取引の確保'}」を目的とし、その趣旨に反する行為も禁止の対象とする。`,
    },
    presentation: null,
    reason: '条文の用語・趣旨が曖昧なため、エージェントが文言の境界を利用している可能性があります（判定ロジックは変えません）。',
    expectedImprovement: 'AI エージェントが条文を読んで行動する場合、趣旨に反する行動が減る可能性があります。形式判定は変わりません。',
    expectedSideEffects: '形式判定は変わらないため、誤拒否は増えません。条文が長くなります。',
  });
  if (rule.intentCriteria.length) {
    drafts.push({
      category: 'system_rule',
      title: '趣旨逸脱の基準を禁止条件（判定）に加える',
      after: {
        ...base,
        text: `${rule.text}\nまた、${rule.intentCriteria.map((c) => c.message).join('。')}場合も禁止する。`,
        checks: [...base.checks, ...rule.intentCriteria.map((c) => ({ code: `${c.code}`.slice(0, 48), message: c.message, violation: c.deviation }))],
        intentCriteria: [],
      },
      presentation: null,
      reason: '事前定義した趣旨逸脱の基準に該当する行動が、形式上は受理されています。',
      expectedImprovement: '趣旨逸脱の基準に該当する行動を規則エンジンが拒否するようになります。',
      expectedSideEffects: '基準が広すぎる場合、正常な行動が拒否されます（回帰テストの誤拒否率で確認してください）。',
    });
  }
  const dirs = new Map<string, 'lower' | 'raise'>();
  rule.checks.forEach((c) => thresholdDirections(c.violation, dirs));
  if (dirs.size) {
    const params = { ...rule.parameters };
    for (const [k, d] of dirs) {
      const v = params[k];
      if (v === undefined) continue;
      params[k] = d === 'lower' ? Math.min(v - 1, Math.floor(v * 0.9)) : Math.max(v + 1, Math.ceil(v * 1.1));
    }
    drafts.push({
      category: 'system_rule',
      title: '閾値を約10%厳しくする',
      after: { ...base, parameters: params, text: `${rule.text}\n（閾値の改定案）${Object.entries(params).map(([k, v]) => `${k} = ${v}`).join('、')}` },
      presentation: null,
      reason: category === 'boundary_exploitation' ? '受理された行動が閾値の直下に集中しているため。' : '閾値を厳しくすることで、問題の行動の一部を防げる可能性があります。',
      expectedImprovement: '閾値の直下を狙った行動が拒否されるようになります。',
      expectedSideEffects: '正常な行動の一部も拒否される可能性があります。',
    });
  }
  if (!cond.includePurpose && rule.purpose.trim()) {
    drafts.push({
      category: 'prompt',
      title: 'エージェントに規制の趣旨を提示する',
      after: null,
      presentation: { includePurpose: true },
      reason: 'エージェントには条文だけが提示され、規制の趣旨が伝わっていません。',
      expectedImprovement: 'AI エージェントが趣旨を考慮して行動する可能性があります（形式判定は変わりません）。',
      expectedSideEffects: 'プロンプトが長くなり、費用・レイテンシが増えます。',
    });
  }
  if (!cond.presentRules) {
    drafts.push({
      category: 'retrieval',
      title: 'エージェントに条文を提示する',
      after: null,
      presentation: { presentRules: true },
      reason: 'エージェントが参照する情報に条文が含まれていません。',
      expectedImprovement: 'エージェントが規則を考慮して行動する可能性があります。',
      expectedSideEffects: 'プロンプトが長くなります。',
    });
  }
  return drafts;
}

const patchHash = (p: Pick<Patch, 'targetRuleId' | 'category' | 'after' | 'presentation'>) => contentHash([p.targetRuleId, p.category, p.after, p.presentation]);

/** Failure のクラスター（と原因の候補）から修正案を作る。同じ内容の修正案は重複して作らない */
export async function generatePatches(input: { fingerprint?: unknown; hypothesisId?: unknown }, actor: Principal): Promise<Patch[]> {
  let fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint : '';
  const hypothesis = typeof input.hypothesisId === 'string' && input.hypothesisId ? await getHypothesis(input.hypothesisId) : null;
  if (hypothesis) fingerprint = hypothesis.fingerprint;
  const failures = (await listFailures({ fingerprint })).filter((f) => f.status !== 'dismissed');
  if (failures.length === 0) throw new ValidationError('修正案の元になる Failure がありません。');
  const groups = new Map<string, Failure[]>();
  for (const f of failures) groups.set(`${f.studyId}|${f.conditionId}`, [...(groups.get(`${f.studyId}|${f.conditionId}`) ?? []), f]);
  const [key, fs] = hypothesis ? [`${hypothesis.sourceStudyId}|${hypothesis.conditionId}`, failures.filter((f) => f.studyId === hypothesis.sourceStudyId && f.conditionId === hypothesis.conditionId)] : [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const [studyId, conditionId] = key.split('|');
  const study = await getStudy(studyId);
  const cond = study?.frozen?.design.conditions.find((c) => c.id === conditionId);
  if (!study?.frozen || !cond) throw new ValidationError('Failure の元の研究が見つかりません。');
  const rules = (await getRuleVersions(cond.ruleVersionIds)).filter((r) => fs[0].ruleKeys.includes(r.ruleKey));
  if (rules.length === 0) throw new ValidationError('修正の対象となる規則がありません。');
  const pairs = await listRulePairs();
  const existing = new Set((await listPatches()).filter((p) => p.status !== 'archived').map(patchHash));
  const created: Patch[] = [];
  for (const rule of rules) {
    const pair = pairs.find((p) => p.ruleA.id === rule.id || p.ruleB.id === rule.id);
    const counterpartId = pair ? (pair.ruleA.id === rule.id ? pair.ruleB.id : pair.ruleA.id) : null;
    const [counterpart] = counterpartId ? await getRuleVersions([counterpartId]) : [];
    for (const d of draftPatches(rule, cond, fs, counterpart ?? null)) {
      if (d.after) parseRuleDefinition(d.after as unknown as Record<string, unknown>);
      const p: Patch = {
        id: randomUUID(),
        ...d,
        targetRuleId: rule.id,
        targetRuleKey: rule.ruleKey,
        before: toDefinition(rule),
        relatedFingerprint: fingerprint,
        relatedHypothesisId: hypothesis?.id ?? null,
        sourceStudyId: studyId,
        sourceConditionId: conditionId,
        generator: PATCH_GENERATOR,
        createdAt: new Date().toISOString(),
        createdBy: actor.displayName,
        status: 'draft',
        reviews: [],
        sandboxRuleId: null,
        experimentStudyId: null,
        isMock: study.isMock,
      };
      if (existing.has(patchHash(p))) continue;
      existing.add(patchHash(p));
      await insertPatch(p);
      created.push(p);
    }
  }
  await audit(actor, 'patch.generate', fingerprint, 'success', `created=${created.length}`);
  return created;
}

const TRANSITIONS: Record<PatchStatus, PatchStatus[]> = {
  draft: ['under_review', 'archived'],
  under_review: ['approved_for_simulation', 'rejected', 'draft', 'archived'],
  approved_for_simulation: ['simulation_completed', 'rejected', 'archived'],
  simulation_completed: ['approved_for_recommendation', 'rejected', 'archived'],
  approved_for_recommendation: ['archived'],
  rejected: ['archived'],
  archived: [],
};

const sandboxKey = (ruleKey: string) => `${ruleKey.slice(0, 34)}-PATCH`;

/** 修正案の状態を変える（研究者の判断）。実験用の承認では、元の規則とは別の規則 ID で実験用の版を作る */
export async function transitionPatch(id: string, input: Record<string, unknown>, actor: Principal): Promise<Patch> {
  const to = input.to as PatchStatus;
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) : '';
  const p = await getPatch(id);
  if (!p) throw new ValidationError('修正案が見つかりません。');
  if (!TRANSITIONS[p.status]?.includes(to)) throw new ValidationError(`「${p.status}」から「${to}」には変更できません。`);
  if (to === 'rejected' && !note) throw new ValidationError('却下する理由を入力してください。', 'note');
  const runs = await listRegressionRuns(id);
  if (to === 'simulation_completed' && runs.length === 0) throw new ValidationError('回帰テストを実行してから完了にしてください。');
  if (to === 'approved_for_recommendation') {
    const gate = runs[0]?.gate;
    if (gate === 'FAIL') throw new ValidationError('最新の回帰テストが FAIL のため、提案として承認できません。');
    if (gate !== 'PASS' && note.length < 10) throw new ValidationError(`最新の回帰テストが ${gate} です。承認する場合は、その判断の理由（10文字以上）を記録してください。`, 'note');
  }
  let sandboxRuleId = p.sandboxRuleId;
  if (to === 'approved_for_simulation' && p.after && !sandboxRuleId) {
    const sandbox = await saveRuleVersion(
      {
        ...(p.after as unknown as Record<string, unknown>),
        ruleKey: sandboxKey(p.targetRuleKey),
        name: `${p.after.name}（修正案 ${p.id.slice(0, 8)}）`,
        references: `修正案 ${p.id} の検証用。仮想環境の実験だけに使い、元の規則（${p.targetRuleKey}）や本番の業務には反映しない。`,
      },
      actor,
    );
    sandboxRuleId = sandbox.id;
  }
  const updated = await updatePatch(id, (x) => {
    x.reviews.push({ from: x.status, to, by: actor.displayName, note, at: new Date().toISOString() });
    x.status = to;
    x.sandboxRuleId = sandboxRuleId;
    return x;
  });
  await audit(actor, 'patch.transition', id, 'success', `${p.status}->${to}`);
  return updated!;
}

/** 修正前（対照）と修正後（処置）を同じ市場・同じシードで比べる再実験を作る */
export async function startPatchExperiment(id: string, input: Record<string, unknown>, actor: Principal): Promise<Patch> {
  const p = await getPatch(id);
  if (!p) throw new ValidationError('修正案が見つかりません。');
  if (!['approved_for_simulation', 'simulation_completed'].includes(p.status)) throw new ValidationError('実験への使用が承認された修正案のみ再実験できます。');
  if (p.experimentStudyId) throw new ValidationError('すでに再実験が作成されています。');
  const source = await getStudy(p.sourceStudyId);
  const cond = source?.frozen?.design.conditions.find((c) => c.id === p.sourceConditionId);
  if (!source?.frozen || !cond) throw new ValidationError('元の研究が見つかりません。');
  const replicates = Number(input.replicates ?? 20);
  if (!Number.isInteger(replicates) || replicates < 2 || replicates > 500) throw new ValidationError('反復数は2〜500の整数にしてください。', 'replicates');
  const treatment: StudyCondition = { ...structuredClone(cond), id: 'T', label: `修正後: ${p.title}` };
  if (p.sandboxRuleId) treatment.ruleVersionIds = cond.ruleVersionIds.map((r) => (r === p.targetRuleId ? p.sandboxRuleId! : r));
  const pres: PresentationChange = p.presentation ?? {};
  if (pres.includePurpose !== undefined) treatment.includePurpose = pres.includePurpose;
  if (pres.presentRules !== undefined) treatment.presentRules = pres.presentRules;
  const d = source.frozen.design;
  const study = await createStudy(
    {
      title: `修正案の再実験: ${p.title}`,
      question: '修正後に逸脱が減り、正常な取引への副作用が許容範囲に収まるか。',
      nullHypothesis: '修正の前後で規則違反率・損益に差はない。',
      alternativeHypothesis: '修正後に規則違反率が変化する。',
      independentVariables: `修正案（${p.category}）`,
      dependentVariables: '規則違反率・趣旨逸脱率・損益・費用・実行時間',
      controlVariables: '市場・シード・モデル・プロンプト（元の研究の条件を複製）',
      analysisPlan: '修正後 − 修正前の差を反復単位の対応のあるブートストラップで評価し、回帰テストの結果と合わせて判断する。',
      conditions: [{ ...structuredClone(cond), id: 'C', label: `修正前: ${cond.label}` }, treatment],
      primaryComparison: { treatment: 'T', control: 'C' },
      replicates,
      baseSeed: d.baseSeed,
      market: d.market,
      agent: d.agent,
      promptSetId: source.frozen.promptSet.id,
    },
    actor,
  );
  if (input.start === true) await startStudy(study.id, actor);
  const updated = await updatePatch(id, (x) => {
    x.experimentStudyId = study.id;
    return x;
  });
  await audit(actor, 'patch.experiment', id, 'success', study.id);
  return updated!;
}

export const PATCH_CATEGORY_ORDER: PatchCategory[] = ['regulatory_text', 'definition', 'system_rule', 'prompt', 'retrieval'];
