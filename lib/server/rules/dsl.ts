import {
  RULE_VARIABLES,
  type EnforcementCheck,
  type IntentCriterion,
  type RuleCondition,
  type RuleExpr,
  type RuleVariable,
} from '@/lib/research/study-types';

// 規則 DSL の検証と評価。
// - 利用者が入力した判定ロジックは JSON の構文木としてのみ扱い、eval や Function は使わない。
// - 参照できる変数・演算子はホワイトリストに限定し、深さ・要素数にも上限を設ける。
// - 評価は純粋関数で、同じ入力からは常に同じ結果を返す（LLM の主張は入力に含まれない）。

export class RuleDslError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'RuleDslError';
  }
}

const MAX_DEPTH = 12;
const MAX_NODES = 300;
const CMP_OPS = new Set(['<', '<=', '>', '>=', '==', '!=']);
const ARITH_OPS = new Set(['add', 'sub', 'mul', 'abs']);
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,47}$/;
const PARAM_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

type Counter = { nodes: number };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(node: Record<string, unknown>, allowed: string[], path: string) {
  for (const k of Object.keys(node)) if (!allowed.includes(k)) throw new RuleDslError(`使用できない項目「${k}」があります`, path);
}

function validateExpr(node: unknown, params: Record<string, number>, path: string, depth: number, counter: Counter): RuleExpr {
  if (++counter.nodes > MAX_NODES) throw new RuleDslError('式が大きすぎます', path);
  if (depth > MAX_DEPTH) throw new RuleDslError('入れ子が深すぎます', path);
  if (!isObject(node)) throw new RuleDslError('式はオブジェクトで指定してください', path);
  if ('var' in node) {
    onlyKeys(node, ['var'], path);
    if (typeof node.var !== 'string' || !(node.var in RULE_VARIABLES)) throw new RuleDslError(`変数「${String(node.var)}」は使用できません`, path);
    return { var: node.var as RuleVariable };
  }
  if ('const' in node) {
    onlyKeys(node, ['const'], path);
    const v = node.const;
    if (typeof v === 'number' && Number.isFinite(v)) return { const: v };
    if (typeof v === 'boolean') return { const: v };
    if (typeof v === 'string' && v.length <= 40) return { const: v };
    throw new RuleDslError('定数は数値・真偽値・40文字以内の文字列にしてください', path);
  }
  if ('param' in node) {
    onlyKeys(node, ['param'], path);
    if (typeof node.param !== 'string' || !(node.param in params)) throw new RuleDslError(`閾値「${String(node.param)}」が定義されていません`, path);
    return { param: node.param };
  }
  if ('op' in node) {
    onlyKeys(node, ['op', 'args'], path);
    if (typeof node.op !== 'string' || !ARITH_OPS.has(node.op)) throw new RuleDslError(`演算子「${String(node.op)}」は使用できません`, path);
    const arity = node.op === 'abs' ? 1 : 2;
    if (!Array.isArray(node.args) || node.args.length !== arity) throw new RuleDslError(`「${node.op}」の引数は${arity}個です`, path);
    return {
      op: node.op as 'add' | 'sub' | 'mul' | 'abs',
      args: node.args.map((a, i) => validateExpr(a, params, `${path}.args[${i}]`, depth + 1, counter)),
    };
  }
  throw new RuleDslError('式の種類（var / const / param / op）がありません', path);
}

function validateCondition(node: unknown, params: Record<string, number>, path: string, depth: number, counter: Counter): RuleCondition {
  if (++counter.nodes > MAX_NODES) throw new RuleDslError('条件が大きすぎます', path);
  if (depth > MAX_DEPTH) throw new RuleDslError('入れ子が深すぎます', path);
  if (!isObject(node)) throw new RuleDslError('条件はオブジェクトで指定してください', path);
  if ('all' in node || 'any' in node) {
    const key = 'all' in node ? 'all' : 'any';
    onlyKeys(node, [key], path);
    const list = node[key];
    if (!Array.isArray(list) || list.length === 0 || list.length > 30) throw new RuleDslError(`「${key}」には1〜30個の条件を指定してください`, path);
    const items = list.map((c, i) => validateCondition(c, params, `${path}.${key}[${i}]`, depth + 1, counter));
    return key === 'all' ? { all: items } : { any: items };
  }
  if ('not' in node) {
    onlyKeys(node, ['not'], path);
    return { not: validateCondition(node.not, params, `${path}.not`, depth + 1, counter) };
  }
  if ('cmp' in node) {
    onlyKeys(node, ['cmp', 'left', 'right'], path);
    if (typeof node.cmp !== 'string' || !CMP_OPS.has(node.cmp)) throw new RuleDslError(`比較演算子「${String(node.cmp)}」は使用できません`, path);
    return {
      cmp: node.cmp as '<' | '<=' | '>' | '>=' | '==' | '!=',
      left: validateExpr(node.left, params, `${path}.left`, depth + 1, counter),
      right: validateExpr(node.right, params, `${path}.right`, depth + 1, counter),
    };
  }
  if ('in' in node) {
    onlyKeys(node, ['in', 'values'], path);
    if (!Array.isArray(node.values) || node.values.length === 0 || node.values.length > 20) throw new RuleDslError('「values」には1〜20個の値を指定してください', path);
    for (const v of node.values) {
      if (!['string', 'number', 'boolean'].includes(typeof v)) throw new RuleDslError('「values」の値は文字列・数値・真偽値にしてください', path);
    }
    return { in: validateExpr(node.in, params, `${path}.in`, depth + 1, counter), values: node.values as (string | number | boolean)[] };
  }
  if ('always' in node) {
    onlyKeys(node, ['always'], path);
    if (node.always !== true) throw new RuleDslError('「always」は true のみ指定できます', path);
    return { always: true };
  }
  throw new RuleDslError('条件の種類（all / any / not / cmp / in / always）がありません', path);
}

export function validateParameters(input: unknown): Record<string, number> {
  if (input === undefined || input === null) return {};
  if (!isObject(input)) throw new RuleDslError('閾値はオブジェクトで指定してください', 'parameters');
  const out: Record<string, number> = {};
  const entries = Object.entries(input);
  if (entries.length > 30) throw new RuleDslError('閾値は30個までです', 'parameters');
  for (const [k, v] of entries) {
    if (!PARAM_PATTERN.test(k)) throw new RuleDslError(`閾値の名前「${k}」は英字で始まる英数字・_ にしてください`, 'parameters');
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RuleDslError(`閾値「${k}」は数値にしてください`, 'parameters');
    out[k] = v;
  }
  return out;
}

function validateCode(code: unknown, path: string): string {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) throw new RuleDslError('違反コードは英大文字で始まる英大文字・数字・_（2〜48文字）にしてください', path);
  return code;
}

function validateMessage(message: unknown, path: string): string {
  if (typeof message !== 'string' || !message.trim() || message.length > 300) throw new RuleDslError('説明は1〜300文字で入力してください', path);
  return message.trim();
}

export function validateChecks(input: unknown, params: Record<string, number>): EnforcementCheck[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 20) throw new RuleDslError('判定は20個までの配列で指定してください', 'checks');
  return input.map((c, i) => {
    const path = `checks[${i}]`;
    if (!isObject(c)) throw new RuleDslError('判定はオブジェクトで指定してください', path);
    onlyKeys(c, ['code', 'message', 'violation'], path);
    return {
      code: validateCode(c.code, `${path}.code`),
      message: validateMessage(c.message, `${path}.message`),
      violation: validateCondition(c.violation, params, `${path}.violation`, 0, { nodes: 0 }),
    };
  });
}

export function validateIntentCriteria(input: unknown, params: Record<string, number>): IntentCriterion[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 20) throw new RuleDslError('趣旨逸脱の基準は20個までの配列で指定してください', 'intentCriteria');
  return input.map((c, i) => {
    const path = `intentCriteria[${i}]`;
    if (!isObject(c)) throw new RuleDslError('基準はオブジェクトで指定してください', path);
    onlyKeys(c, ['code', 'message', 'deviation'], path);
    return {
      code: validateCode(c.code, `${path}.code`),
      message: validateMessage(c.message, `${path}.message`),
      deviation: validateCondition(c.deviation, params, `${path}.deviation`, 0, { nodes: 0 }),
    };
  });
}

// ---------- 評価 ----------

export type RuleScope = Record<RuleVariable, number | string | boolean>;

/** 小数の誤差を避けるため、算術結果を 1e-6 単位に丸める */
const roundNum = (n: number) => Math.round(n * 1e6) / 1e6;

function evalExpr(expr: RuleExpr, scope: RuleScope, params: Record<string, number>): number | string | boolean {
  if ('var' in expr) return scope[expr.var];
  if ('const' in expr) return expr.const;
  if ('param' in expr) return params[expr.param];
  const values = expr.args.map((a) => evalExpr(a, scope, params));
  const nums = values.map((v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number.NaN));
  switch (expr.op) {
    case 'add':
      return roundNum(nums[0] + nums[1]);
    case 'sub':
      return roundNum(nums[0] - nums[1]);
    case 'mul':
      return roundNum(nums[0] * nums[1]);
    case 'abs':
      return Math.abs(nums[0]);
  }
}

function compare(op: string, a: number | string | boolean, b: number | string | boolean): boolean {
  if (op === '==') return typeof a === 'number' && typeof b === 'number' ? roundNum(a) === roundNum(b) : a === b;
  if (op === '!=') return !compare('==', a, b);
  if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) return false;
  const x = roundNum(a);
  const y = roundNum(b);
  switch (op) {
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    case '>=':
      return x >= y;
  }
  return false;
}

/**
 * 「閾値付近」の度合い: 現在は成立していない条件が、数値の比較1つだけを相対的にどれだけ動かせば成立するか。
 * - cmp（数値）: 成立していなければ |左辺 − 右辺| / max(|右辺|, 1)。
 * - all: 成立していない子が1つだけのとき、その子の値。2つ以上なら閾値付近ではない（Infinity）。
 * - any: 子の最小値。not / in / always は対象外（Infinity）。
 * 成立している条件は 0 を返す。業界に依存しない汎用の指標で、規則の境界を狙った行動の集中度の算出に使う。
 */
export function nearMissMargin(cond: RuleCondition, scope: RuleScope, params: Record<string, number>): number {
  if (evaluateCondition(cond, scope, params)) return 0;
  if ('cmp' in cond) {
    const a = evalExpr(cond.left, scope, params);
    const b = evalExpr(cond.right, scope, params);
    if (typeof a !== 'number' || typeof b !== 'number' || cond.cmp === '==' || cond.cmp === '!=') return Number.POSITIVE_INFINITY;
    return Math.abs(a - b) / Math.max(Math.abs(b), 1);
  }
  if ('all' in cond) {
    const failing = cond.all.filter((c) => !evaluateCondition(c, scope, params));
    return failing.length === 1 ? nearMissMargin(failing[0], scope, params) : Number.POSITIVE_INFINITY;
  }
  if ('any' in cond) return Math.min(...cond.any.map((c) => nearMissMargin(c, scope, params)));
  return Number.POSITIVE_INFINITY;
}

export function evaluateCondition(cond: RuleCondition, scope: RuleScope, params: Record<string, number>): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, scope, params));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, scope, params));
  if ('not' in cond) return !evaluateCondition(cond.not, scope, params);
  if ('cmp' in cond) return compare(cond.cmp, evalExpr(cond.left, scope, params), evalExpr(cond.right, scope, params));
  if ('in' in cond) {
    const v = evalExpr(cond.in, scope, params);
    return cond.values.some((x) => compare('==', v, x));
  }
  return true;
}
