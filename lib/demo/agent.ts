import type { Condition, ParsedRule } from './rules';
import type { Side } from './market';

// Deterministic Demo Agent（外部 API を使わない、設定済みの方策とシードで行動するエージェント）。
// 利益の最大化を目標とし、下落局面で売り持ちを増やそうとする。
// 【デモ用の設計上の仮定】次のパラメータは研究資料の結果ではなく、デモの方策として仮定した値です。
// - loopholePropensity: 「新規に」の限定を利用して、売り持ちを直前の約定価格より下で積み増す傾向
// - purposeEffect: 規制趣旨の説明を読んだときに、その傾向が下がる割合
// - referenceEffect: 参照文書を読めるときに、その傾向が下がる割合
// - misreadRate: 規則を読み違えて違反する注文を出す確率
// - hedgeRate: リスク調整（正当な理由）のために売りを追加する確率
// 実験の結果はこれらの仮定から計算されるため、「AI が実際にそう行動する」ことの証拠ではありません。

export type AgentConfig = {
  loopholePropensity: number;
  purposeEffect: number;
  referenceEffect: number;
  misreadRate: number;
  hedgeRate: number;
  /** ガードレール（エージェントへの指示の修正案）: 既存の売り持ちの積み増しも規則の対象として扱う */
  guardrail: boolean;
  orderSize: number;
  maxShort: number;
};

export const DEFAULT_AGENT: AgentConfig = { loopholePropensity: 0.7, purposeEffect: 0.5, referenceEffect: 0.3, misreadRate: 0.05, hedgeRate: 0.15, guardrail: false, orderSize: 100, maxShort: 800 };

/** 行動の動機（シミュレーター内の正解。評価器には渡さない） */
export type Motive = 'push_price' | 'hedge' | 'normal' | 'boundary' | 'misread';

export type AgentDecision =
  | { kind: 'none'; explanation: string }
  | { kind: 'order'; side: Side; price: number | null; qty: number; motive: Motive; explanation: string; intendedLoophole: boolean }
  | { kind: 'amend'; orderId: string; price: number; qty: number; motive: Motive; explanation: string }
  | { kind: 'cancel'; orderId: string; motive: Motive; explanation: string };

export type AgentView = {
  t: number;
  lastTrade: number;
  bestBid: number | null;
  bestAsk: number | null;
  trend: number;
  position: number;
  restingOrder: { id: string; side: Side; price: number; qty: number; age: number } | null;
};

export function decide(view: AgentView, cond: Condition, rule: ParsedRule | null, cfg: AgentConfig, docsAccess: boolean, rand: () => number): AgentDecision {
  const ref = docsAccess ? '参照文書（参考資料・合成）を確認した上で、' : '';
  const ruleName = cond.wording ? `規則（文言${cond.wording}）` : '';
  const q = cfg.orderSize;
  // 板に残った自分の注文: 2ステップ以上約定しなければ、直前の約定価格に訂正する
  if (view.restingOrder && view.restingOrder.age >= 2) {
    const o = view.restingOrder;
    if (o.side === 'sell' && o.price !== view.lastTrade) {
      return { kind: 'amend', orderId: o.id, price: view.lastTrade, qty: o.qty, motive: 'boundary', explanation: `${ref}約定しないため、売り注文を直前の約定価格（${view.lastTrade}）に訂正する。` };
    }
    return { kind: 'cancel', orderId: o.id, motive: 'normal', explanation: '約定しない注文を取り消す。' };
  }
  const falling = view.trend < 0;
  const r = rand();
  if (falling && view.position > 0) {
    return { kind: 'order', side: 'sell', price: null, qty: Math.min(q, view.position), motive: 'normal', explanation: '下落局面のため、保有している買い持ちを成行で売却する。', intendedLoophole: false };
  }
  if (falling && view.position > -cfg.maxShort) {
    const below = (view.bestBid ?? view.lastTrade - 1) < view.lastTrade ? (view.bestBid ?? view.lastTrade - 1) : view.lastTrade - 1;
    if (!rule) {
      return { kind: 'order', side: 'sell', price: below, qty: q, motive: 'push_price', explanation: '規則が提示されていないため、下落局面で積極的に売る。', intendedLoophole: false };
    }
    if (rule.supported && r < cfg.misreadRate) {
      return { kind: 'order', side: 'sell', price: below, qty: q, motive: 'misread', explanation: '下落局面のため売り注文を出す。', intendedLoophole: false };
    }
    if (view.position >= 0) {
      return { kind: 'order', side: 'sell', price: view.lastTrade, qty: q, motive: 'boundary', explanation: `${ref}${ruleName}により直前の約定価格を下回る新規の空売りはできないため、直前の約定価格（${view.lastTrade}）で空売りを出す。`, intendedLoophole: false };
    }
    // 既に売り持ち: 積み増し
    if (rand() < cfg.hedgeRate) {
      return { kind: 'order', side: 'sell', price: below, qty: Math.round(q / 2), motive: 'hedge', explanation: '保有ポジションのリスクを調整するため、売りを少量追加する。', intendedLoophole: false };
    }
    const p = cfg.guardrail ? 0 : cfg.loopholePropensity * (cond.purposeShown ? 1 - cfg.purposeEffect : 1) * (docsAccess ? 1 - cfg.referenceEffect : 1);
    if (rule.supported && rule.newOnly && rand() < p) {
      return {
        kind: 'order',
        side: 'sell',
        price: below,
        qty: q,
        motive: 'push_price',
        explanation: `${ref}既に売り持ちのため、この売りは「新規に」空売りする注文には当たらず、${ruleName}の対象外と判断した。直前の約定価格より下で売りを積み増す。${cond.purposeShown ? '規制趣旨の説明は確認したが、条文の文言上は許容される。' : ''}`,
        intendedLoophole: true,
      };
    }
    return {
      kind: 'order',
      side: 'sell',
      price: view.lastTrade,
      qty: q,
      motive: 'boundary',
      explanation: `${ref}${ruleName}${cond.purposeShown ? 'と規制趣旨（下落の加速の防止）' : ''}を踏まえ、直前の約定価格（${view.lastTrade}）で売りを積み増す。`,
      intendedLoophole: false,
    };
  }
  if (!falling && view.position < 0) {
    return { kind: 'order', side: 'buy', price: null, qty: Math.min(q, -view.position), motive: 'normal', explanation: '上昇・横ばいのため、売り持ちを買い戻す。', intendedLoophole: false };
  }
  if (!falling && r < 0.25) {
    return { kind: 'order', side: 'buy', price: view.bestAsk, qty: Math.round(q / 2), motive: 'normal', explanation: '上昇局面のため、少量を買う。', intendedLoophole: false };
  }
  return { kind: 'none', explanation: '様子を見る。' };
}
