import { mulberry32 } from './rng';

// 簡易的な指値注文板（Limit Order Book）。合成市場のみ（外部の市場には接続しない）。
// - 価格優先・時間優先で約定する。成行は相手側の最良気配から順に約定し、残りは取り消す。
// - 訂正（amend）: 価格を変えるか数量を増やすと時間優先を失う（再登録）。数量を減らすだけなら優先を保つ。
// - 背景の参加者（マーケットメイカーとノイズトレーダー）は、シードから決まる行動をとる。
// 単純化: 手数料・値幅制限・板寄せ・空売りの貸株・複数銘柄・遅延はない（docs に記載）。

export type Side = 'buy' | 'sell';
export type Order = { id: string; owner: string; side: Side; price: number; qty: number; ts: number; status: 'open' | 'filled' | 'cancelled' | 'partial' };
export type Trade = { t: number; price: number; qty: number; buyer: string; seller: string; aggressor: Side };
export type MarketState = {
  t: number;
  bids: Order[];
  asks: Order[];
  trades: Trade[];
  lastTrade: number;
  nextId: number;
  fundamental: number;
  seed: number;
  trend: number;
};

export type MarketConfig = { initialPrice: number; trend: number; volatility: number };

export function initMarket(cfg: MarketConfig, seed: number): MarketState {
  const s: MarketState = { t: 0, bids: [], asks: [], trades: [], lastTrade: cfg.initialPrice, nextId: 1, fundamental: cfg.initialPrice, seed, trend: cfg.trend };
  for (let i = 1; i <= 4; i++) {
    addResting(s, 'mm', 'buy', cfg.initialPrice - i, 100);
    addResting(s, 'mm', 'sell', cfg.initialPrice + i, 100);
  }
  return s;
}

const sortBook = (s: MarketState) => {
  s.bids.sort((a, b) => b.price - a.price || a.ts - b.ts);
  s.asks.sort((a, b) => a.price - b.price || a.ts - b.ts);
};

function addResting(s: MarketState, owner: string, side: Side, price: number, qty: number, ts = s.t): Order {
  const o: Order = { id: `O${s.nextId++}`, owner, side, price, qty, ts: ts * 1000 + s.nextId, status: 'open' };
  (side === 'buy' ? s.bids : s.asks).push(o);
  sortBook(s);
  return o;
}

export type SubmitResult = { order: Order | null; fills: Trade[]; restingQty: number };

/** 指値注文（price = null なら成行）。約定する分を約定し、指値の残りは板に載せる */
export function submit(s: MarketState, owner: string, side: Side, price: number | null, qty: number): SubmitResult {
  const book = side === 'buy' ? s.asks : s.bids;
  const fills: Trade[] = [];
  let remaining = qty;
  while (remaining > 0 && book.length) {
    const best = book[0];
    const crosses = price === null || (side === 'buy' ? best.price <= price : best.price >= price);
    if (!crosses) break;
    const q = Math.min(remaining, best.qty);
    const trade: Trade = { t: s.t, price: best.price, qty: q, buyer: side === 'buy' ? owner : best.owner, seller: side === 'sell' ? owner : best.owner, aggressor: side };
    fills.push(trade);
    s.trades.push(trade);
    s.lastTrade = best.price;
    best.qty -= q;
    remaining -= q;
    if (best.qty === 0) {
      best.status = 'filled';
      book.shift();
    } else best.status = 'partial';
  }
  let order: Order | null = null;
  if (remaining > 0 && price !== null) order = addResting(s, owner, side, price, remaining);
  return { order, fills, restingQty: order ? order.qty : 0 };
}

export function cancel(s: MarketState, id: string): Order | null {
  for (const book of [s.bids, s.asks]) {
    const i = book.findIndex((o) => o.id === id);
    if (i >= 0) {
      const [o] = book.splice(i, 1);
      o.status = 'cancelled';
      return o;
    }
  }
  return null;
}

/** 訂正: 数量の減少のみなら時間優先を保つ。価格の変更・数量の増加は取り消して再発注（優先を失う、約定しうる） */
export function amend(s: MarketState, id: string, price: number, qty: number): { order: Order | null; fills: Trade[]; keptPriority: boolean } {
  const all = [...s.bids, ...s.asks];
  const o = all.find((x) => x.id === id);
  if (!o) return { order: null, fills: [], keptPriority: false };
  if (price === o.price && qty <= o.qty) {
    o.qty = qty;
    return { order: o, fills: [], keptPriority: true };
  }
  cancel(s, id);
  const r = submit(s, o.owner, o.side, price, qty);
  return { order: r.order, fills: r.fills, keptPriority: false };
}

export const bestBid = (s: MarketState) => s.bids[0]?.price ?? null;
export const bestAsk = (s: MarketState) => s.asks[0]?.price ?? null;
export const mid = (s: MarketState) => {
  const b = bestBid(s);
  const a = bestAsk(s);
  return b !== null && a !== null ? (a + b) / 2 : s.lastTrade;
};

/** 背景の参加者の1ステップ（シードと時刻から決まる） */
export function backgroundStep(s: MarketState, cfg: MarketConfig) {
  const rand = mulberry32((s.seed * 7919 + s.t * 104729) >>> 0);
  // 本質的価値のランダムウォーク（トレンドつき）
  s.fundamental = Math.max(10, s.fundamental + s.trend + Math.round((rand() - 0.5) * 2 * cfg.volatility));
  // マーケットメイカー: 古い注文を取り消し、本質的価値の周りに気配を出す
  for (const o of [...s.bids, ...s.asks]) if (o.owner === 'mm' && s.t * 1000 - o.ts > 3000) cancel(s, o.id);
  const f = Math.round(s.fundamental);
  for (let i = 1; i <= 2; i++) {
    if (!s.bids.some((o) => o.price === f - i)) addResting(s, 'mm', 'buy', f - i, 50 + Math.floor(rand() * 100));
    if (!s.asks.some((o) => o.price === f + i)) addResting(s, 'mm', 'sell', f + i, 50 + Math.floor(rand() * 100));
  }
  // ノイズトレーダー: 成行の売買
  if (rand() < 0.6) {
    const side: Side = rand() < 0.5 + Math.max(-0.2, Math.min(0.2, s.trend * -0.1)) ? 'sell' : 'buy';
    submit(s, 'noise', side, null, 10 + Math.floor(rand() * 60));
  }
}

export function advance(s: MarketState, cfg: MarketConfig) {
  s.t += 1;
  backgroundStep(s, cfg);
}
