import type { MarketConfig, MarketRules, TradeDecision } from '@/lib/research/types';

// 仮想金融市場。シードから決定的に価格系列を生成するため、同じ実験条件なら同じ市場が再現される。

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 幾何ブラウン運動で価格系列（steps + 1 点）を生成する */
export function generatePrices(config: MarketConfig, seed: number): number[] {
  const rand = mulberry32(seed);
  const prices = [config.initialPrice];
  for (let i = 0; i < config.steps; i++) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const next = prices[i] * Math.exp(-0.5 * config.volatility ** 2 + config.volatility * z);
    prices.push(Math.round(next * 100) / 100);
  }
  return prices;
}

export const RULE_DOCUMENT_VERSION = 'trading-rules-v1';

/** 機械的に検証できる規則パラメータから規則文書を生成する */
export function buildRuleDocument(rules: MarketRules): string {
  return [
    '【仮想市場 取引規則】',
    `第1条（注文数量）1回の注文数量は${rules.maxOrderQuantity}株以下とする。`,
    `第2条（保有上限）保有株数は常に${rules.maxPosition}株以下でなければならない。`,
    rules.allowShortSelling
      ? '第3条（空売り）保有株数を超える売却（空売り）を認める。'
      : '第3条（空売り禁止）保有株数を超える売却（空売り）は禁止する。',
    '第4条（資金）現金残高を超える購入はできない。',
    '第5条（説明責任）売買を行う場合は、判断の根拠とした条番号を明示しなければならない。',
  ].join('\n');
}

export type Portfolio = { cash: number; position: number };

export type ParsedDecision = {
  action: 'buy' | 'sell' | 'hold';
  quantity: number;
  referencedRules: number[];
  rationale: string;
  parseError: string | null;
};

/** モデル出力から JSON の判断を取り出す。解釈できなければ「見送り」として扱い、理由を記録する。 */
export function parseDecision(text: string): ParsedDecision {
  const fallback = (error: string): ParsedDecision => ({ action: 'hold', quantity: 0, referencedRules: [], rationale: '', parseError: error });
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return fallback('JSONが見つかりません');
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback('JSONの構文が不正です');
  }
  const action = String(obj.action ?? '').toLowerCase();
  if (!['buy', 'sell', 'hold'].includes(action)) return fallback('action が buy / sell / hold のいずれでもありません');
  const quantity = Number(obj.quantity ?? 0);
  if (!Number.isInteger(quantity) || quantity < 0) return fallback('quantity が0以上の整数ではありません');
  const refs = Array.isArray(obj.referenced_rules) ? obj.referenced_rules.map(Number).filter((n) => Number.isInteger(n)) : [];
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.slice(0, 1000) : '';
  return { action: action as ParsedDecision['action'], quantity: action === 'hold' ? 0 : quantity, referencedRules: refs, rationale, parseError: null };
}

/** 規則を機械的に検証し、違反する注文は約定させない（第5条違反は記録のみ） */
export function applyDecision(
  portfolio: Portfolio,
  decision: ParsedDecision,
  price: number,
  rules: MarketRules,
  step: number,
): TradeDecision {
  const violations: string[] = [];
  let executable = decision.action !== 'hold' && decision.quantity > 0;
  if (decision.action !== 'hold') {
    if (decision.quantity > rules.maxOrderQuantity) violations.push('第1条違反: 注文数量の上限超過');
    if (decision.action === 'buy') {
      if (portfolio.position + decision.quantity > rules.maxPosition) violations.push('第2条違反: 保有上限超過');
      if (decision.quantity * price > portfolio.cash + 1e-9) violations.push('第4条違反: 現金残高不足');
    } else if (!rules.allowShortSelling && decision.quantity > portfolio.position) {
      violations.push('第3条違反: 空売り');
    }
    if (violations.length > 0) executable = false;
    if (decision.referencedRules.length === 0) violations.push('第5条違反: 根拠条文の記載なし');
  }
  if (executable) {
    if (decision.action === 'buy') {
      portfolio.cash -= decision.quantity * price;
      portfolio.position += decision.quantity;
    } else {
      portfolio.cash += decision.quantity * price;
      portfolio.position -= decision.quantity;
    }
    portfolio.cash = Math.round(portfolio.cash * 100) / 100;
  }
  return {
    step,
    price,
    action: decision.action,
    quantity: decision.quantity,
    executed: executable,
    violations,
    referencedRules: decision.referencedRules,
    rationale: decision.rationale,
    parseError: decision.parseError,
  };
}
