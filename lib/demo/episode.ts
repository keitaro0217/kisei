import { decide, type AgentConfig, type Motive } from './agent';
import { buildAxis, classify, judgeAxis, type BuildAxis, type Classification, type JudgeAxis } from './grading';
import { advance, amend, bestAsk, bestBid, cancel, initMarket, submit, type MarketConfig, type MarketState, type Trade } from './market';
import { deriveSeed, mulberry32 } from './rng';
import { conditionOf, formalCheck, parseRuleText, type ConditionId, type ParsedRule, type RuleSet } from './rules';

// 1エピソードの実行。エージェントの動作サイクル（観測 → 規制確認 → 判断 → 実行 → 損益確認 → 再判断）を記録する。
// 同じ設定・同じシードからは常に同じ結果になる（描画の速度には依存しない）。

export const AGENT_ID = 'demo-agent-1';

export type EpisodeConfig = {
  condition: ConditionId;
  rules: RuleSet;
  agent: AgentConfig;
  market: MarketConfig;
  steps: number;
  docsAccess: boolean;
};

export type TraceStep = {
  t: number;
  observation: { lastTrade: number; bestBid: number | null; bestAsk: number | null; trend: number; position: number; cash: number };
  ruleVersion: string;
  retrievedDocuments: string[];
  action: { kind: 'order' | 'amend' | 'cancel' | 'none'; side?: 'buy' | 'sell'; price?: number | null; qty?: number; orderId?: string };
  toolCall: string;
  result: { accepted: boolean; filledQty: number; restingQty: number; message: string };
  build: BuildAxis | null;
  judge: JudgeAxis | null;
  classification: Classification | null;
  /** アプリが生成した説明（デモの方策のテンプレート）。LLM の出力ではない */
  explanation: string;
  explanationSource: 'app_template';
  pnl: number;
  /** シミュレーター内の正解（評価器には渡していない。分析で検出の正しさを測るためだけに使う） */
  groundTruth: { motive: Motive | null };
};

export type EpisodeMetrics = {
  orders: number;
  shortSales: number;
  formalViolations: number;
  intentCandidates: number;
  /** 正当な理由の注文（シミュレーター内の正解）と、そのうち規則で拒否されたもの */
  benignOrders: number;
  benignRejected: number;
  boundaryOrders: number;
  amends: number;
  cancels: number;
  pnl: number;
  /** 正解の「価格を押し下げる意図の積み増し」と、Build 軸の候補の一致 */
  truePush: number;
  candidateHits: number;
  classes: Record<Classification, number>;
};

export type EpisodeResult = { seed: number; metrics: EpisodeMetrics; trace: TraceStep[]; finalMarket: MarketState; parsedRule: ParsedRule | null };

const emptyClasses = (): Record<Classification, number> => ({ formal_ok_intent_ok: 0, formal_ok_intent_deviation_candidate: 0, formal_violation: 0, contested: 0, insufficient_evidence: 0, unevaluable: 0 });

export function ruleFor(cfg: Pick<EpisodeConfig, 'condition' | 'rules'>): ParsedRule | null {
  const c = conditionOf(cfg.condition);
  if (!c.wording) return null;
  return parseRuleText(c.wording === 'A' ? cfg.rules.textA : cfg.rules.textB);
}

/** 段階的に進めるための状態（マーケットシミュレーターの Start / Step / Pause で使う） */
export type EpisodeRunner = {
  cfg: EpisodeConfig;
  seed: number;
  market: MarketState;
  position: number;
  cash: number;
  history: number[];
  trace: TraceStep[];
  metrics: EpisodeMetrics;
  agentOrderId: string | null;
  agentOrderAge: number;
  rule: ParsedRule | null;
  done: boolean;
};

export function startEpisode(cfg: EpisodeConfig, seed: number): EpisodeRunner {
  const market = initMarket(cfg.market, seed);
  return {
    cfg,
    seed,
    market,
    position: 0,
    cash: 0,
    history: [market.lastTrade],
    trace: [],
    metrics: { orders: 0, shortSales: 0, formalViolations: 0, intentCandidates: 0, benignOrders: 0, benignRejected: 0, boundaryOrders: 0, amends: 0, cancels: 0, pnl: 0, truePush: 0, candidateHits: 0, classes: emptyClasses() },
    agentOrderId: null,
    agentOrderAge: 0,
    rule: ruleFor(cfg),
    done: false,
  };
}

function applyFills(r: EpisodeRunner, fills: Trade[]) {
  for (const f of fills) {
    if (f.buyer === AGENT_ID) {
      r.position += f.qty;
      r.cash -= f.qty * f.price;
    }
    if (f.seller === AGENT_ID) {
      r.position -= f.qty;
      r.cash += f.qty * f.price;
    }
  }
}

/** 1ステップ進める */
export function stepEpisode(r: EpisodeRunner): TraceStep | null {
  if (r.done) return null;
  const { cfg } = r;
  const cond = conditionOf(cfg.condition);
  const before = r.market.trades.length;
  advance(r.market, cfg.market);
  // 背景の参加者との約定で、板に残した自分の注文が約定した分
  applyFills(r, r.market.trades.slice(before));
  r.history.push(r.market.lastTrade);
  const own = [...r.market.bids, ...r.market.asks].find((o) => o.id === r.agentOrderId && o.owner === AGENT_ID);
  if (!own) r.agentOrderId = null;
  else r.agentOrderAge += 1;
  const lookback = r.history[Math.max(0, r.history.length - 6)];
  const trend = r.market.lastTrade - lookback;
  const view = { t: r.market.t, lastTrade: r.market.lastTrade, bestBid: bestBid(r.market), bestAsk: bestAsk(r.market), trend, position: r.position };
  const docs = [...(cond.wording ? [`条文${cond.wording}（v${cfg.rules.version}）`] : []), ...(cond.purposeShown ? ['規制趣旨の説明'] : []), ...(cfg.docsAccess && cond.wording ? ['参考資料（合成）'] : [])];
  const rand = mulberry32(deriveSeed(r.seed, r.market.t));
  const d = decide({ ...view, restingOrder: own ? { id: own.id, side: own.side, price: own.price, qty: own.qty, age: r.agentOrderAge } : null }, cond, r.rule, cfg.agent, cfg.docsAccess && !!cond.wording, rand);
  const step: TraceStep = {
    t: r.market.t,
    observation: { ...view, cash: r.cash },
    ruleVersion: cond.wording ? `${cond.wording}@v${cfg.rules.version}` : 'no-rule',
    retrievedDocuments: docs,
    action: { kind: d.kind },
    toolCall: 'none',
    result: { accepted: true, filledQty: 0, restingQty: 0, message: '' },
    build: null,
    judge: null,
    classification: null,
    explanation: d.explanation,
    explanationSource: 'app_template',
    pnl: 0,
    groundTruth: { motive: d.kind === 'none' ? null : d.motive },
  };
  const presented = { purposeShown: cond.purposeShown, documents: cfg.docsAccess && !!cond.wording };
  if (d.kind === 'order' || d.kind === 'amend') {
    const side = d.kind === 'order' ? d.side : (own?.side ?? 'sell');
    const price = d.price;
    const qty = d.qty;
    // 形式判定は注文を出す前に行い、違反する注文は合成市場に出さない（サンドボックスの規則ゲート）
    const formal = formalCheck(r.rule, { side, price: price ?? (side === 'sell' ? (view.bestBid ?? view.lastTrade) : (view.bestAsk ?? view.lastTrade)), qty }, { position: r.position, lastTrade: r.market.lastTrade });
    const build = buildAxis({ side, price, qty, positionBefore: r.position, lastTrade: r.market.lastTrade, trend, formal });
    const judge = judgeAxis(d.explanation, presented);
    const cls = classify(build, judge);
    step.action = { kind: d.kind, side, price, qty, orderId: d.kind === 'amend' ? d.orderId : undefined };
    step.toolCall = d.kind === 'order' ? `market.submit(${side}, ${price ?? 'market'}, ${qty})` : `market.amend(${d.orderId}, ${price}, ${qty})`;
    step.build = build;
    step.judge = judge;
    step.classification = cls;
    const m = r.metrics;
    m.orders += 1;
    if (build.isShortSale) m.shortSales += 1;
    if (build.boundary) m.boundaryOrders += 1;
    if (d.kind === 'amend') m.amends += 1;
    if (formal.verdict === 'REJECT') m.formalViolations += 1;
    if (build.intentCandidate && formal.verdict !== 'REJECT') m.intentCandidates += 1;
    m.classes[cls] += 1;
    const benign = d.motive === 'normal' || d.motive === 'hedge' || d.motive === 'boundary';
    if (benign) m.benignOrders += 1;
    if (benign && formal.verdict === 'REJECT') m.benignRejected += 1;
    if (d.motive === 'push_price') {
      m.truePush += 1;
      if (build.intentCandidate) m.candidateHits += 1;
    }
    if (formal.verdict === 'REJECT') {
      step.result = { accepted: false, filledQty: 0, restingQty: 0, message: `規則により拒否: ${formal.message}` };
    } else {
      if (d.kind === 'amend') {
        const res = amend(r.market, d.orderId, d.price, d.qty);
        applyFills(r, res.fills);
        r.agentOrderId = res.order?.id ?? null;
        r.agentOrderAge = 0;
        step.result = { accepted: true, filledQty: res.fills.reduce((a, f) => a + f.qty, 0), restingQty: res.order?.qty ?? 0, message: res.keptPriority ? '訂正（時間優先を維持）' : '訂正（再発注・時間優先を失う）' };
      } else {
        if (r.agentOrderId) {
          cancel(r.market, r.agentOrderId);
          r.agentOrderId = null;
        }
        const res = submit(r.market, AGENT_ID, side, price, qty);
        applyFills(r, res.fills);
        r.agentOrderId = res.order?.id ?? null;
        r.agentOrderAge = 0;
        const filled = res.fills.reduce((a, f) => a + f.qty, 0);
        step.result = { accepted: true, filledQty: filled, restingQty: res.restingQty, message: filled ? `${filled}株 約定` : '板に登録' };
      }
      if (formal.verdict === 'UNSUPPORTED') step.result.message += '（規則を判定できないため、形式判定は評価不能）';
    }
  } else if (d.kind === 'cancel') {
    cancel(r.market, d.orderId);
    r.agentOrderId = null;
    r.metrics.cancels += 1;
    step.action = { kind: 'cancel', orderId: d.orderId };
    step.toolCall = `market.cancel(${d.orderId})`;
    step.result = { accepted: true, filledQty: 0, restingQty: 0, message: '取消' };
  }
  step.pnl = Math.round(r.cash + r.position * r.market.lastTrade);
  r.metrics.pnl = step.pnl;
  r.trace.push(step);
  if (r.market.t >= cfg.steps) r.done = true;
  return step;
}

export function runEpisode(cfg: EpisodeConfig, seed: number, keepTrace = true): EpisodeResult {
  const r = startEpisode(cfg, seed);
  while (!r.done) stepEpisode(r);
  return { seed, metrics: r.metrics, trace: keepTrace ? r.trace : [], finalMarket: r.market, parsedRule: r.rule };
}
