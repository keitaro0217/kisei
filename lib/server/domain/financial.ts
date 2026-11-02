import { DOMAINS } from '@/lib/domain/descriptors';
import type { DomainAction, FormalResult, IntentResult } from '@/lib/domain/model';
import type { AttemptedAction, RuleVersion } from '@/lib/research/study-types';
import { applyAction as exchangeApply, centsOf, initialExchangeState, judgeAction, markToMarket, settleRestingOrders, type ExchangeState } from '../research/sim/exchange';
import { generatePrices } from '../research/sim/market';
import { mockTraderResponse, parseTraderResponse } from '../research/study/trader';
import type { MarketConfig } from '@/lib/research/types';
import type { DomainAdapter, ScenarioConfig, StepResult } from './adapter';

// 金融市場アダプター: 既存の金融市場シミュレーション（外生価格＋単純約定）を共通のインターフェースで包む。
// 判定・約定は既存の関数（judgeAction / applyAction / settleRestingOrders）をそのまま使い、結果は既存の研究の実行と一致する
// （tests/domain.test.ts で確認）。既存の研究は従来どおり study/studies.ts の実行で動き、判断は rc_decisions に記録する。

export type FinancialState = { exchange: ExchangeState; prices: number[]; step: number; config: { steps: number; initialCash: number; initialPrice: number; volatility: number } };

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function toAttempted(a: DomainAction): AttemptedAction {
  if (a.parse === 'invalid') return { parse: 'invalid', parseError: 'invalid', action: null, orderType: null, quantity: null, limitPrice: null, cancelOrderId: null, raw: a.raw ?? '' };
  const t = a.type;
  return {
    parse: 'valid',
    parseError: null,
    action: t === 'buy' || t === 'sell' || t === 'cancel' || t === 'hold' ? t : null,
    orderType: a.args.order_type === 'limit' ? 'limit' : t === 'buy' || t === 'sell' ? 'market' : null,
    quantity: typeof a.args.quantity === 'number' ? a.args.quantity : null,
    limitPrice: typeof a.args.limit_price === 'number' ? a.args.limit_price : null,
    cancelOrderId: typeof a.args.cancel_order_id === 'string' ? a.args.cancel_order_id : null,
    raw: a.raw ?? '',
  };
}

/** 既存の取引エージェントの出力（JSON）から共通の行動へ */
export function fromAttempted(a: AttemptedAction): DomainAction {
  if (a.parse === 'invalid' || !a.action) return { type: 'invalid', args: {}, parse: 'invalid', raw: a.raw };
  return {
    type: a.action,
    args: { order_type: a.orderType, quantity: a.quantity, limit_price: a.limitPrice, cancel_order_id: a.cancelOrderId },
    parse: 'ok',
    raw: a.raw,
  };
}

const clone = (s: FinancialState): FinancialState => ({ ...s, exchange: structuredClone(s.exchange), prices: s.prices, config: s.config });

export const financialMarketAdapter: DomainAdapter<FinancialState> = {
  descriptor: DOMAINS.financial_market,
  initializeScenario(config: ScenarioConfig, seed: number) {
    const c = { steps: num(config.steps, 20), initialCash: num(config.initialCash, 1_000_000), initialPrice: num(config.initialPrice, 1_000), volatility: num(config.volatility, 0.02) };
    return { exchange: initialExchangeState(c.initialCash, c.initialPrice), prices: generatePrices({ ...c } as MarketConfig, seed), step: 0, config: c };
  },
  reset(config, seed) {
    return this.initializeScenario(config, seed);
  },
  steps(config) {
    return num(config.steps, 20);
  },
  observe(s) {
    const e = s.exchange;
    return {
      step: s.step,
      view: { price: s.prices[s.step], lastTradePrice: e.lastTradeCents / 100, cash: e.cashCents / 100, position: e.position, openOrders: e.openOrders.map((o) => ({ id: o.id, side: o.side, quantity: o.quantity, limitPrice: o.limitCents / 100 })) },
    };
  },
  listPermittedActions(s, allowed) {
    return DOMAINS.financial_market.actions.filter((a) => (!allowed || allowed.includes(a.type)) && (a.type !== 'cancel' || s.exchange.openOrders.length > 0));
  },
  validateAction(s, a) {
    if (a.parse === 'invalid') return { ok: false, errors: [{ code: 'INVALID', message: '行動を解釈できません' }] };
    const r = judgeAction(s.exchange, centsOf(s.prices[s.step]), toAttempted(a), []);
    const sys = r.violations.filter((v) => v.ruleKey === null);
    return { ok: sys.length === 0, errors: sys.map((v) => ({ code: v.code, message: v.message })) };
  },
  evaluateFormalCompliance(s, a, rules): FormalResult {
    const r = judgeAction(s.exchange, centsOf(s.prices[s.step]), toAttempted(a), rules);
    return { verdict: r.verdict === 'NO_ORDER' ? 'NO_ACTION' : r.verdict, violations: r.violations };
  },
  evaluateIntentAlignment(s, a, rules): IntentResult {
    const r = judgeAction(s.exchange, centsOf(s.prices[s.step]), toAttempted(a), rules);
    return { deviations: r.intentDeviations };
  },
  applyAction(s, a, rules: RuleVersion[]): StepResult<FinancialState> {
    const next = clone(s);
    const priceCents = centsOf(next.prices[next.step]);
    next.exchange.step = next.step;
    // 既存の実行と同じ順序: 板に残った注文の約定 → 行動の判定と適用
    const settled = settleRestingOrders(next.exchange, priceCents);
    const enf = exchangeApply(next.exchange, priceCents, toAttempted(a), rules);
    const events = [...settled.filled.map((f) => `約定 ${f.id} ${f.side} ${f.quantity}`), ...(enf.filledQuantity ? [`約定 ${enf.filledQuantity}株 @${enf.fillPrice}`] : [])];
    const before = markToMarket(s.exchange, priceCents);
    next.step += 1;
    const after = markToMarket(next.exchange, priceCents);
    return {
      state: next,
      formal: { verdict: enf.verdict === 'NO_ORDER' ? 'NO_ACTION' : enf.verdict, violations: enf.violations },
      intent: { deviations: enf.intentDeviations },
      outcome: { reward: after - before, events },
    };
  },
  calculateOutcome(s) {
    const last = s.prices[Math.min(s.step, s.prices.length - 1)];
    const value = markToMarket(s.exchange, centsOf(last));
    return { reward: value - s.config.initialCash, metrics: { finalValue: value, position: s.exchange.position, cancels: s.exchange.cancelsThisSession }, notes: [] };
  },
  getEvidence(s, a, result) {
    return [
      { kind: 'state', ref: `price@${s.step}`, detail: `価格 ${s.prices[s.step]}、保有 ${s.exchange.position}` },
      { kind: 'action', ref: a.type, detail: JSON.stringify(a.args) },
      ...result.formal.violations.map((v) => ({ kind: 'rule' as const, ref: v.ruleKey ?? 'system', detail: `${v.code}: ${v.message}` })),
      ...result.intent.deviations.map((v) => ({ kind: 'rule' as const, ref: v.ruleKey, detail: `${v.code}: ${v.message}` })),
    ];
  },
  mockAction(s, seed) {
    const e = s.exchange;
    const text = mockTraderResponse(seed, s.step, { price: s.prices[s.step], position: e.position, cash: e.cashCents / 100, openOrders: e.openOrders });
    return fromAttempted(parseTraderResponse(text).attempted);
  },
  parseAction(text) {
    const r = parseTraderResponse(text);
    return { action: fromAttempted(r.attempted), rationale: r.reasoning.rationale ?? null };
  },
  responseFormat() {
    return '{"action": "buy" | "sell" | "cancel" | "hold", "order_type": "market" | "limit", "quantity": 整数, "limit_price": 数値, "cancel_order_id": "O1", "rationale": "理由"}';
  },
};
