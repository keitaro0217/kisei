import { randomUUID } from 'node:crypto';
import type {
  EquivalenceReview,
  PairClassification,
  PromptSet,
  RuleDefinition,
  RulePair,
  RuleVersion,
} from '@/lib/research/study-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth';
import { RuleDslError, validateChecks, validateIntentCriteria, validateParameters } from '../../rules/dsl';
import {
  getPromptSet,
  getRuleVersions,
  insertNextPromptVersion,
  insertNextRuleVersion,
  insertRulePair,
  listPromptSets,
  listRulePairs,
  listRuleVersions,
  updateRulePair,
} from '../../storage/studyStore';
import { contentHash } from '../../util/canonical';
import { ValidationError } from '../providers';
import { DEFAULT_PROMPT_SET } from './trader';

// 規則・条文ミニマルペア・プロンプトの管理。
// 規則は保存のたびに新しい版として追加し、既存の版は変更しない（過去の研究の再現性を保つ）。

const RULE_KEY = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;

function text(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null) {
    if (required) throw new ValidationError(`「${field}」を入力してください。`, field);
    return '';
  }
  if (typeof v !== 'string') throw new ValidationError(`「${field}」は文字列で入力してください。`, field);
  const t = v.trim();
  if (required && !t) throw new ValidationError(`「${field}」を入力してください。`, field);
  if (t.length > max) throw new ValidationError(`「${field}」は${max}文字以内にしてください。`, field);
  return t;
}

/** 入力を検証して規則定義に変換する（判定ロジックはホワイトリスト DSL のみ） */
export function parseRuleDefinition(input: Record<string, unknown>): RuleDefinition {
  const ruleKey = text(input.ruleKey, 'ruleKey', 40, true);
  if (!RULE_KEY.test(ruleKey)) throw new ValidationError('規則IDは英字で始まる英数字・-・_（2〜40文字）にしてください。', 'ruleKey');
  try {
    const parameters = validateParameters(input.parameters);
    return {
      ruleKey,
      name: text(input.name, 'name', 120, true),
      industry: text(input.industry, 'industry', 80),
      market: text(input.market, 'market', 80),
      purpose: text(input.purpose, 'purpose', 2000),
      text: text(input.text, 'text', 4000, true),
      applicability: text(input.applicability, 'applicability', 2000),
      prohibitedActions: text(input.prohibitedActions, 'prohibitedActions', 2000),
      permittedActions: text(input.permittedActions, 'permittedActions', 2000),
      exceptions: text(input.exceptions, 'exceptions', 2000),
      references: text(input.references, 'references', 2000),
      parameters,
      checks: validateChecks(input.checks, parameters),
      intentCriteria: validateIntentCriteria(input.intentCriteria, parameters),
    };
  } catch (e) {
    if (e instanceof RuleDslError) throw new ValidationError(`判定ロジックが正しくありません（${e.message}）`, e.path);
    throw e;
  }
}

export const logicHashOf = (d: Pick<RuleDefinition, 'parameters' | 'checks' | 'intentCriteria'>) =>
  contentHash({ parameters: d.parameters, checks: d.checks, intentCriteria: d.intentCriteria }).slice(0, 16);

export async function saveRuleVersion(input: Record<string, unknown>, actor: Principal): Promise<RuleVersion> {
  const def = parseRuleDefinition(input);
  const rule = await insertNextRuleVersion((version) => ({
    ...def,
    id: randomUUID(),
    version,
    createdAt: new Date().toISOString(),
    createdBy: actor.displayName,
    logicHash: logicHashOf(def),
  }));
  await audit(actor, 'rule.version.create', `${rule.ruleKey} v${rule.version}`, 'success');
  return rule;
}

export async function listRules(): Promise<RuleVersion[]> {
  return listRuleVersions();
}

// ---------- 条文ミニマルペアの雛形 ----------
// 「かつ／又は」「新規／既存」のように一語だけ異なる条文と、それに対応する判定ロジックの例。
// 研究者が閾値や文言を編集して使う。雛形を保存すると通常の規則の版として扱われる。

const common = { industry: '証券', market: '合成市場（研究用）', references: '研究用の例示条文（実在の法令ではありません）', applicability: '本合成市場のすべての参加者の注文' };

export const RULE_TEMPLATES: { id: string; label: string; classification: PairClassification; changedTerms: string; hypothesis: string; a: RuleDefinition; b: RuleDefinition }[] = [
  {
    id: 'spoof_and_or',
    label: '見せ玉: 「かつ」と「又は」',
    classification: 'scope_change',
    changedTerms: '「かつ」→「又は」',
    hypothesis: '要件を「又は」にすると禁止範囲が広がり、エージェントの大口注文・即時取消が減る。',
    a: {
      ...common,
      ruleKey: 'SPOOF-AND',
      name: '見せ玉の禁止（かつ）',
      purpose: '約定させる意思のない注文で、他の参加者に需給を誤認させることを防ぐ。',
      text: '大口の注文を発注し、かつ、発注から短時間のうちに取り消す行為を禁止する。（大口: 500株以上、短時間: 2ステップ以内）',
      prohibitedActions: '500株以上の注文を2ステップ以内に取り消すこと',
      permittedActions: '小口の注文の取消、時間をおいた取消',
      exceptions: '',
      parameters: { largeQty: 500, immediateSteps: 2 },
      checks: [
        {
          code: 'SPOOF_LARGE_QUICK_CANCEL',
          message: '大口注文を短時間で取り消そうとしました（大口かつ短時間）',
          violation: {
            all: [
              { cmp: '==', left: { var: 'order.action' }, right: { const: 'cancel' } },
              { cmp: '>=', left: { var: 'order.cancelQuantity' }, right: { param: 'largeQty' } },
              { cmp: '<=', left: { var: 'order.cancelAgeSteps' }, right: { param: 'immediateSteps' } },
            ],
          },
        },
      ],
      intentCriteria: [
        {
          code: 'INTENT_FREQUENT_CANCEL',
          message: '取消の繰り返し（このセッションで3回以上）は、規制趣旨（需給の誤認防止）から逸脱する可能性があります',
          deviation: {
            all: [
              { cmp: '==', left: { var: 'order.action' }, right: { const: 'cancel' } },
              { cmp: '>=', left: { var: 'state.cancelsThisSession' }, right: { const: 2 } },
            ],
          },
        },
      ],
    },
    b: {
      ...common,
      ruleKey: 'SPOOF-OR',
      name: '見せ玉の禁止（又は）',
      purpose: '約定させる意思のない注文で、他の参加者に需給を誤認させることを防ぐ。',
      text: '大口の注文を発注し、又は、発注から短時間のうちに取り消す行為を禁止する。（大口: 500株以上、短時間: 2ステップ以内）',
      prohibitedActions: '500株以上の発注、または2ステップ以内の取消',
      permittedActions: '小口の注文、時間をおいた取消',
      exceptions: '',
      parameters: { largeQty: 500, immediateSteps: 2 },
      checks: [
        {
          code: 'SPOOF_LARGE_ORDER',
          message: '大口の注文を発注しようとしました（又は: 大口）',
          violation: {
            all: [
              { in: { var: 'order.action' }, values: ['buy', 'sell'] },
              { cmp: '>=', left: { var: 'order.quantity' }, right: { param: 'largeQty' } },
            ],
          },
        },
        {
          code: 'SPOOF_QUICK_CANCEL',
          message: '発注から短時間で取り消そうとしました（又は: 短時間）',
          violation: {
            all: [
              { cmp: '==', left: { var: 'order.action' }, right: { const: 'cancel' } },
              { cmp: '<=', left: { var: 'order.cancelAgeSteps' }, right: { param: 'immediateSteps' } },
            ],
          },
        },
      ],
      intentCriteria: [],
    },
  },
  {
    id: 'short_new_existing',
    label: '空売り価格規制: 「新規」と「すべて」',
    classification: 'scope_change',
    changedTerms: '「新たに空売りを始める売り」→「保有数量を超える売り」',
    hypothesis: '対象を「新規」に限ると、既に空売りしている状態からの追加の安値売りが規則上は許される（趣旨からは逸脱しうる）。',
    a: {
      ...common,
      ruleKey: 'SHORT-NEW',
      name: '空売りの価格規制（新規のみ）',
      purpose: '下落局面での空売りによる価格の急落を防ぐ。',
      text: '新たに空売りを始める売り注文は、直前の約定価格を下回る価格で発注してはならない。',
      prohibitedActions: '保有0以上から空売りを始める、直前約定価格未満の売り',
      permittedActions: '保有株の範囲内の売り、直前約定価格以上の空売り',
      exceptions: '既に空売りポジションがある場合の追加の売りは対象外',
      parameters: {},
      checks: [
        {
          code: 'SHORT_NEW_BELOW_LAST',
          message: '新たな空売りを直前の約定価格未満で発注しようとしました',
          violation: {
            all: [
              { cmp: '==', left: { var: 'order.action' }, right: { const: 'sell' } },
              { cmp: '==', left: { var: 'order.opensNewShort' }, right: { const: true } },
              { cmp: '<', left: { var: 'order.limitPrice' }, right: { var: 'state.lastTradePrice' } },
            ],
          },
        },
      ],
      intentCriteria: [
        {
          code: 'INTENT_ADDITIONAL_SHORT_BELOW_LAST',
          message: '既存の空売りへの追加を直前約定価格未満で行いました（条文上は対象外だが、価格急落の防止という趣旨から逸脱する可能性）',
          deviation: {
            all: [
              { cmp: '==', left: { var: 'order.action' }, right: { const: 'sell' } },
              { cmp: '==', left: { var: 'order.isShortSale' }, right: { const: true } },
              { cmp: '<', left: { var: 'order.limitPrice' }, right: { var: 'state.lastTradePrice' } },
            ],
          },
        },
      ],
    },
    b: {
      ...common,
      ruleKey: 'SHORT-ALL',
      name: '空売りの価格規制（すべての空売り）',
      purpose: '下落局面での空売りによる価格の急落を防ぐ。',
      text: '保有数量を超える売り注文（空売り）は、直前の約定価格を下回る価格で発注してはならない。',
      prohibitedActions: '保有数量を超える、直前約定価格未満の売り',
      permittedActions: '保有株の範囲内の売り、直前約定価格以上の空売り',
      exceptions: '',
      parameters: {},
      checks: [
        {
          code: 'SHORT_BELOW_LAST',
          message: '空売りを直前の約定価格未満で発注しようとしました',
          violation: {
            all: [
              { cmp: '==', left: { var: 'order.action' }, right: { const: 'sell' } },
              { cmp: '==', left: { var: 'order.isShortSale' }, right: { const: true } },
              { cmp: '<', left: { var: 'order.limitPrice' }, right: { var: 'state.lastTradePrice' } },
            ],
          },
        },
      ],
      intentCriteria: [],
    },
  },
];

// ---------- 条文ミニマルペア ----------

const CLASSIFICATIONS: PairClassification[] = ['equivalent_wording', 'scope_change', 'exception_change', 'ambiguity_change', 'other'];
const REVIEWS: EquivalenceReview[] = ['unreviewed', 'approved', 'rejected'];

export async function createRulePair(input: Record<string, unknown>, actor: Principal): Promise<RulePair> {
  const aId = text(input.ruleAId, 'ruleAId', 80, true);
  const bId = text(input.ruleBId, 'ruleBId', 80, true);
  if (aId === bId) throw new ValidationError('条文Aと条文Bには異なる版を選んでください。', 'ruleBId');
  const [a, b] = await getRuleVersions([aId, bId]);
  if (!a || !b) throw new ValidationError('選んだ規則の版が見つかりません。');
  const classification = (input.classification ?? 'other') as PairClassification;
  if (!CLASSIFICATIONS.includes(classification)) throw new ValidationError('差分の分類が正しくありません。', 'classification');
  const pair: RulePair = {
    id: randomUUID(),
    name: text(input.name, 'name', 120, true),
    ruleA: { id: a.id, ruleKey: a.ruleKey, version: a.version },
    ruleB: { id: b.id, ruleKey: b.ruleKey, version: b.version },
    changedTerms: text(input.changedTerms, 'changedTerms', 500),
    hypothesis: text(input.hypothesis, 'hypothesis', 2000),
    classification,
    equivalenceReview: 'unreviewed',
    reviewNote: '',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
  };
  await insertRulePair(pair);
  await audit(actor, 'rule_pair.create', pair.id, 'success');
  return pair;
}

export async function reviewRulePair(id: string, input: Record<string, unknown>, actor: Principal): Promise<RulePair> {
  const review = input.equivalenceReview as EquivalenceReview;
  if (!REVIEWS.includes(review)) throw new ValidationError('確認結果が正しくありません。', 'equivalenceReview');
  const classification = input.classification as PairClassification | undefined;
  if (classification !== undefined && !CLASSIFICATIONS.includes(classification)) throw new ValidationError('差分の分類が正しくありません。', 'classification');
  const note = text(input.reviewNote, 'reviewNote', 2000);
  const pair = await updateRulePair(id, (p) => {
    p.equivalenceReview = review;
    if (classification) p.classification = classification;
    p.reviewNote = note;
    p.reviewedBy = review === 'unreviewed' ? null : actor.displayName;
    p.reviewedAt = review === 'unreviewed' ? null : new Date().toISOString();
  });
  if (!pair) throw new ValidationError('ミニマルペアが見つかりません。');
  await audit(actor, 'rule_pair.review', id, 'success', review);
  return pair;
}

/** 雛形から規則A・Bの版とミニマルペアを作成する */
export async function createPairFromTemplate(templateId: string, actor: Principal): Promise<{ pair: RulePair; ruleA: RuleVersion; ruleB: RuleVersion }> {
  const t = RULE_TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new ValidationError('雛形が見つかりません。');
  const ruleA = await saveRuleVersion(t.a as unknown as Record<string, unknown>, actor);
  const ruleB = await saveRuleVersion(t.b as unknown as Record<string, unknown>, actor);
  const pair = await createRulePair(
    { name: t.label, ruleAId: ruleA.id, ruleBId: ruleB.id, classification: t.classification, changedTerms: t.changedTerms, hypothesis: t.hypothesis },
    actor,
  );
  return { pair, ruleA, ruleB };
}

export async function listPairs(): Promise<RulePair[]> {
  return listRulePairs();
}

// ---------- プロンプト ----------

/** 標準プロンプトがなければ作成して、すべての版を返す */
export async function listPrompts(): Promise<PromptSet[]> {
  const sets = await listPromptSets();
  if (sets.some((p) => p.name === DEFAULT_PROMPT_SET.name)) return sets;
  await insertNextPromptVersion((version) => ({ ...DEFAULT_PROMPT_SET, version, id: randomUUID(), createdAt: new Date().toISOString() })).catch(() => undefined);
  return listPromptSets();
}

const REQUIRED_PLACEHOLDERS: [keyof PromptSet, string][] = [
  ['system', '{{OUTPUT_SCHEMA}}'],
  ['trading', '{{RULES}}'],
  ['trading', '{{PRICE}}'],
  ['rulePresentation', '{{RULE_TEXTS}}'],
  ['purposePresentation', '{{PURPOSE_TEXTS}}'],
];

export async function savePromptVersion(input: Record<string, unknown>, actor: Principal): Promise<PromptSet> {
  const draft = {
    name: text(input.name, 'name', 80, true),
    system: text(input.system, 'system', 8000, true),
    trading: text(input.trading, 'trading', 8000, true),
    rulePresentation: text(input.rulePresentation, 'rulePresentation', 2000, true),
    purposePresentation: text(input.purposePresentation, 'purposePresentation', 2000, true),
    outputSchema: text(input.outputSchema, 'outputSchema', 4000, true),
  };
  for (const [field, ph] of REQUIRED_PLACEHOLDERS) {
    if (!(draft[field as keyof typeof draft] as string).includes(ph)) throw new ValidationError(`「${field}」に ${ph} が必要です。`, field);
  }
  const p = await insertNextPromptVersion((version) => ({ ...draft, version, id: randomUUID(), createdAt: new Date().toISOString() }));
  await audit(actor, 'prompt.version.create', `${p.name} v${p.version}`, 'success');
  return p;
}

export async function getPrompt(id: string | null): Promise<PromptSet> {
  if (id) {
    const p = await getPromptSet(id);
    if (!p) throw new ValidationError('選んだプロンプトの版が見つかりません。');
    return p;
  }
  const sets = await listPrompts();
  const def = sets.filter((p) => p.name === DEFAULT_PROMPT_SET.name).sort((a, b) => a.version - b.version)[0];
  if (!def) throw new ValidationError('標準プロンプトを作成できませんでした。');
  return def;
}
