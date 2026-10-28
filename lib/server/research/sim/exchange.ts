import type {
  AttemptedAction,
  EnforcementResult,
  PortfolioState,
  RuleEvaluation,
  RuleVersion,
} from '@/lib/research/study-types';
import { evaluateCondition, type RuleScope } from '../../rules/dsl';

// 外生的な価格系列＋単純約定モデル（exogenous_simple）の取引所。
// - 価格系列はシードから生成した外生系列で、エージェントの注文は価格に影響しない。
// - 金額は内部で「銭」（1/100円）単位の整数として扱い、浮動小数点の誤差を避ける。
// - 実行可否は規則エンジン（決定論的な DSL 評価）だけで決まり、AI の適法性の主張は判定に使わない。
// 板取引（LOB）モードは別実装とし、このモードと同じ市場条件として比較しない。

export type OpenOrder = { id: string; side: 'buy' | 'sell'; quantity: number; limitCents: number; placedStep: number };

export type ExchangeState = {
  step: number;
  cashCents: number;
  position: number;
  lastTradeCents: number;
  openOrders: OpenOrder[];
  cancelsThisSession: number;
  nextOrderNo: number;
};

const toCents = (yen: number) => Math.round(yen * 100);
const toYen = (cents: number) => cents / 100;

export function initialExchangeState(initialCash: number, initialPrice: number): ExchangeState {
  return { step: 0, cashCents: toCents(initialCash), position: 0, lastTradeCents: toCents(initialPrice), openOrders: [], cancelsThisSession: 0, nextOrderNo: 1 };
}

export function snapshotState(s: ExchangeState, priceCents: number): PortfolioState {
  return { cash: toYen(s.cashCents), position: s.position, price: toYen(priceCents), openOrders: s.openOrders.length };
}

/**
 * ステップ開始時に、未約定の指値注文を現在価格で約定させる（買いは価格が指値以下、売りは指値以上）。
 * 約定に必要な現金が足りない買い注文は取り消す（受理時点の判定はやり直さない）。
 */
export function settleRestingOrders(s: ExchangeState, priceCents: number): { filled: { id: string; side: string; quantity: number; priceCents: number }[]; cancelled: string[] } {
  const filled: { id: string; side: string; quantity: number; priceCents: number }[] = [];
  const cancelled: string[] = [];
  const remaining: OpenOrder[] = [];
  for (const o of s.openOrders) {
    const crosses = o.side === 'buy' ? priceCents <= o.limitCents : priceCents >= o.limitCents;
    if (!crosses) {
      remaining.push(o);
      continue;
    }
    const notional = priceCents * o.quantity;
    if (o.side === 'buy' && notional > s.cashCents) {
      cancelled.push(o.id);
      continue;
    }
    s.cashCents += o.side === 'buy' ? -notional : notional;
    s.position += o.side === 'buy' ? o.quantity : -o.quantity;
    s.lastTradeCents = priceCents;
    filled.push({ id: o.id, side: o.side, quantity: o.quantity, priceCents });
  }
  s.openOrders = remaining;
  return { filled, cancelled };
}

function buildScope(s: ExchangeState, priceCents: number, a: AttemptedAction): RuleScope {
  const action = a.action ?? 'hold';
  const qty = action === 'buy' || action === 'sell' ? (a.quantity ?? 0) : 0;
  const limitCents = a.orderType === 'limit' && a.limitPrice != null ? toCents(a.limitPrice) : priceCents;
  const notionalCents = qty * limitCents;
  const cancelTarget = action === 'cancel' ? s.openOrders.find((o) => o.id === a.cancelOrderId) : undefined;
  const afterPosition = action === 'buy' ? s.position + qty : action === 'sell' ? s.position - qty : s.position;
  const afterCash = action === 'buy' ? s.cashCents - notionalCents : action === 'sell' ? s.cashCents + notionalCents : s.cashCents;
  return {
    'order.action': action,
    'order.type': a.orderType ?? 'market',
    'order.quantity': qty,
    'order.limitPrice': toYen(limitCents),
    'order.notional': toYen(notionalCents),
    'order.isShortSale': action === 'sell' && qty > s.position,
    'order.opensNewShort': action === 'sell' && s.position >= 0 && qty > s.position,
    'order.cancelQuantity': cancelTarget?.quantity ?? 0,
    'order.cancelAgeSteps': cancelTarget ? s.step - cancelTarget.placedStep : -1,
    'state.step': s.step,
    'state.price': toYen(priceCents),
    'state.lastTradePrice': toYen(s.lastTradeCents),
    'state.cash': toYen(s.cashCents),
    'state.position': s.position,
    'state.openOrders': s.openOrders.length,
    'state.cancelsThisSession': s.cancelsThisSession,
    'after.position': afterPosition,
    'after.cash': toYen(afterCash),
  };
}

/** 規則エンジンによる判定のみ（状態は変更しない） */
export function judgeAction(s: ExchangeState, priceCents: number, a: AttemptedAction, rules: RuleVersion[]) {
  const before = snapshotState(s, priceCents);
  if (a.parse === 'invalid' || !a.action) {
    return { verdict: 'INVALID' as const, violations: [], evaluations: [] as RuleEvaluation[], intentDeviations: [], before };
  }
  if (a.action === 'hold') {
    return { verdict: 'NO_ORDER' as const, violations: [], evaluations: [] as RuleEvaluation[], intentDeviations: [], before };
  }

  const violations: EnforcementResult['violations'] = [];
  // 取引所としての基本的な可否（規則とは別の system コード）
  if (a.action === 'buy' || a.action === 'sell') {
    if (!Number.isInteger(a.quantity) || (a.quantity ?? 0) <= 0 || (a.quantity ?? 0) > 1_000_000) {
      violations.push({ code: 'SYS_INVALID_QUANTITY', message: '注文数量は1〜1,000,000の整数でなければなりません', ruleKey: null });
    }
    if (a.orderType === 'limit' && !(a.limitPrice != null && a.limitPrice > 0)) {
      violations.push({ code: 'SYS_INVALID_PRICE', message: '指値は正の数でなければなりません', ruleKey: null });
    }
  }
  if (a.action === 'cancel' && !s.openOrders.some((o) => o.id === a.cancelOrderId)) {
    violations.push({ code: 'SYS_UNKNOWN_ORDER', message: '取消対象の未約定注文がありません', ruleKey: null });
  }
  const scope = buildScope(s, priceCents, a);
  if (a.action === 'buy' && violations.length === 0 && (scope['after.cash'] as number) < 0) {
    violations.push({ code: 'SYS_INSUFFICIENT_CASH', message: '現金残高が不足しています', ruleKey: null });
  }

  const evaluations: RuleEvaluation[] = [];
  for (const rule of rules) {
    for (const check of rule.checks) {
      const violated = evaluateCondition(check.violation, scope, rule.parameters);
      evaluations.push({ ruleId: rule.id, ruleKey: rule.ruleKey, version: rule.version, code: check.code, violated });
      if (violated) violations.push({ code: check.code, message: check.message, ruleKey: rule.ruleKey });
    }
  }
  const verdict = violations.length > 0 ? ('REJECT' as const) : ('ACCEPT' as const);
  const intentDeviations: EnforcementResult['intentDeviations'] = [];
  if (verdict === 'ACCEPT') {
    for (const rule of rules) {
      for (const c of rule.intentCriteria) {
        if (evaluateCondition(c.deviation, scope, rule.parameters)) intentDeviations.push({ code: c.code, message: c.message, ruleKey: rule.ruleKey });
      }
    }
  }
  return { verdict, violations, evaluations, intentDeviations, before };
}

/** 判定と、受理された場合の約定・注文登録を行う */
export function applyAction(s: ExchangeState, priceCents: number, a: AttemptedAction, rules: RuleVersion[]): EnforcementResult {
  const judged = judgeAction(s, priceCents, a, rules);
  let filledQuantity = 0;
  let fillPrice: number | null = null;
  if (judged.verdict === 'ACCEPT') {
    if (a.action === 'cancel') {
      s.openOrders = s.openOrders.filter((o) => o.id !== a.cancelOrderId);
      s.cancelsThisSession += 1;
    } else if (a.action === 'buy' || a.action === 'sell') {
      const qty = a.quantity!;
      const limitCents = a.orderType === 'limit' ? toCents(a.limitPrice!) : null;
      const marketable = limitCents === null || (a.action === 'buy' ? limitCents >= priceCents : limitCents <= priceCents);
      if (marketable) {
        const notional = priceCents * qty;
        s.cashCents += a.action === 'buy' ? -notional : notional;
        s.position += a.action === 'buy' ? qty : -qty;
        s.lastTradeCents = priceCents;
        filledQuantity = qty;
        fillPrice = toYen(priceCents);
      } else {
        s.openOrders.push({ id: `O${s.nextOrderNo++}`, side: a.action, quantity: qty, limitCents: limitCents!, placedStep: s.step });
      }
    }
  }
  return {
    verdict: judged.verdict,
    violations: judged.violations,
    evaluations: judged.evaluations,
    intentDeviations: judged.intentDeviations,
    filledQuantity,
    fillPrice,
    before: judged.before,
    after: snapshotState(s, priceCents),
  };
}

export function markToMarket(s: ExchangeState, priceCents: number): number {
  return toYen(s.cashCents + s.position * priceCents);
}

export const centsOf = toCents;
