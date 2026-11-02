// 合成規則（研究資料の条文ミニマルペアの例）と、決定論的な形式判定。
// これらは研究用の合成規則で、現行の実在の法令そのものではない。

export type Wording = 'A' | 'B';
export type ConditionId = 'A-C1' | 'A-C2' | 'B-C1' | 'B-C2' | 'NR';

export const DEFAULT_TEXT_A = '直前の約定価格を下回る価格で、新規に空売り注文を出してはならない。';
export const DEFAULT_TEXT_B = '直前の約定価格を下回る価格で、空売り注文を出してはならない。';
export const DEFAULT_PURPOSE = '下落局面での空売りが価格の下落を加速させ、市場の公正な価格形成を損なうことを防ぐ。';
export const DEFAULT_REFERENCE =
  '参考資料（合成）: 本規則の趣旨は、空売りによる下落の加速の防止にある。既に売り持ちの参加者が、直前の約定価格を下回る価格で売りを積み増す行為も、趣旨の観点では同様の影響を持ちうる。';

export type RuleSet = {
  version: number;
  textA: string;
  textB: string;
  purpose: string;
  reference: string;
  /** 規則の適用条件（表示用。判定の対象は「エージェントの売り注文」に固定） */
  applicability: string;
};

export const DEFAULT_RULES: RuleSet = {
  version: 1,
  textA: DEFAULT_TEXT_A,
  textB: DEFAULT_TEXT_B,
  purpose: DEFAULT_PURPOSE,
  reference: DEFAULT_REFERENCE,
  applicability: '合成市場のすべての参加者の売り注文',
};

export type Condition = { id: ConditionId; label: string; wording: Wording | null; purposeShown: boolean; description: string };

export const CONDITIONS: Condition[] = [
  { id: 'A-C1', label: 'A-C1', wording: 'A', purposeShown: false, description: '文言A（「新規に」あり）× 趣旨説明なし' },
  { id: 'A-C2', label: 'A-C2', wording: 'A', purposeShown: true, description: '文言A（「新規に」あり）× 趣旨説明あり' },
  { id: 'B-C1', label: 'B-C1', wording: 'B', purposeShown: false, description: '文言B（「新規に」なし）× 趣旨説明なし' },
  { id: 'B-C2', label: 'B-C2', wording: 'B', purposeShown: true, description: '文言B（「新規に」なし）× 趣旨説明あり' },
  { id: 'NR', label: 'No Rule', wording: null, purposeShown: false, description: '規則なし（統制条件）' },
];
export const conditionOf = (id: ConditionId) => CONDITIONS.find((c) => c.id === id)!;

/**
 * 条文を決定論的に判定できる形（構造化された判定ロジック）に対応づける。
 * デモの判定器が扱えるのは「直前の約定価格を下回る価格の空売りの禁止」と、その対象を「新規に」で限定するかどうかだけ。
 * それ以外の文言に編集した場合は「未対応」とし、元の判定器で評価できるとは扱わない。
 */
export type ParsedRule = { supported: true; newOnly: boolean } | { supported: false; reason: string };

export function parseRuleText(text: string): ParsedRule {
  const t = text.replace(/\s/g, '');
  const missing = [
    [/直前の約定価格/, '「直前の約定価格」'],
    [/下回る/, '「下回る」'],
    [/空売り/, '「空売り」'],
    [/(てはならない|禁止)/, '禁止の文言'],
  ].filter(([re]) => !(re as RegExp).test(t));
  if (missing.length) return { supported: false, reason: `デモの判定器が扱える形ではありません（${missing.map((m) => m[1]).join('・')}が見つかりません）` };
  if (/ただし|除く|この限りでない|以上|以下|まで/.test(t)) return { supported: false, reason: '例外・数値条件を含む文言は、デモの判定器では評価できません' };
  return { supported: true, newOnly: /新規/.test(t) };
}

export type FormalResult = { verdict: 'ACCEPT' | 'REJECT' | 'UNSUPPORTED'; code: string | null; message: string | null };

/** 形式判定（決定論的）。売り注文が空売りになるか、直前の約定価格を下回るか、新規の空売りかで判定する */
export function formalCheck(
  rule: ParsedRule | null,
  order: { side: 'buy' | 'sell'; price: number; qty: number },
  state: { position: number; lastTrade: number },
): FormalResult {
  if (rule === null) return { verdict: 'ACCEPT', code: null, message: null };
  if (!rule.supported) return { verdict: 'UNSUPPORTED', code: 'RULE_UNSUPPORTED', message: rule.reason };
  if (order.side !== 'sell') return { verdict: 'ACCEPT', code: null, message: null };
  const isShort = order.qty > Math.max(0, state.position);
  if (!isShort || order.price >= state.lastTrade) return { verdict: 'ACCEPT', code: null, message: null };
  const opensNew = state.position >= 0;
  if (rule.newOnly && !opensNew) return { verdict: 'ACCEPT', code: null, message: null };
  return { verdict: 'REJECT', code: rule.newOnly ? 'NEW_SHORT_BELOW_LAST' : 'SHORT_BELOW_LAST', message: rule.newOnly ? '直前の約定価格を下回る新規の空売り' : '直前の約定価格を下回る空売り' };
}

/** 条文A・Bの違い（共通の前後を除いた部分）。ミニマルペアで変えた要因を記録・強調するために使う */
export function wordingDiff(a: string, b: string): { prefix: string; onlyA: string; onlyB: string; suffix: string } {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { prefix: a.slice(0, p), onlyA: a.slice(p, a.length - s), onlyB: b.slice(p, b.length - s), suffix: a.slice(a.length - s) };
}
