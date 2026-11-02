import type { RuleElementKind } from '@/lib/domain/model';

// 規則の要素の抽出（pattern-v1）。日本語の規則の文型（「〜しなければならない」「〜してはならない」など）による抽出で、
// AI による解釈ではない。抽出した要素は「未レビュー」とし、人が承認・却下・修正する。
// 規則の目的は「目的の候補」として抽出するだけで、確定は人の承認による（PolicyIntent）。

export type ExtractedElement = { kind: RuleElementKind; text: string; start: number; end: number; value?: { number: number; unit: string } | null };

const PATTERNS: [RuleElementKind, RegExp][] = [
  ['prohibition', /((て|で)はならない|を禁止する|禁止とする|してはいけない|できない。)/],
  ['obligation', /(しなければならない|なければならない|ものとする|義務を負う|を要する)/],
  ['permission', /(することができる|ことができる|差し支えない|認める。)/],
  ['exception', /(ただし|この限りでない|を除く|除き|例外とする)/],
  ['approval_condition', /(承認を得|承認を受け|許可を得|決裁|承認なしに)/],
  ['definition', /(とは、|をいう。|をいう$|と定義する)/],
  ['purpose_candidate', /(目的|ことを防ぐ|ことを防止|を確保する|のため、|ために)/],
];

const UNIT = /(\d[\d,，]*(?:\.\d+)?)\s*(億円|万円|円|株|営業日|日|件|%|％|時間|か月|ヶ月|年)/g;

/** 文（「。」・改行で区切る）ごとに要素を抽出する。位置は元の本文の文字オフセット */
export function extractRuleElements(text: string): ExtractedElement[] {
  const out: ExtractedElement[] = [];
  const re = /[^。\n]+(?:。|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const sentence = raw.trim();
    if (!sentence) continue;
    const start = m.index + lead;
    const end = start + sentence.length;
    for (const [kind, p] of PATTERNS) if (p.test(sentence)) out.push({ kind, text: sentence, start, end });
    let u: RegExpExecArray | null;
    UNIT.lastIndex = 0;
    while ((u = UNIT.exec(sentence))) {
      const n = Number(u[1].replace(/[,，]/g, ''));
      const mult = u[2] === '万円' ? 10_000 : u[2] === '億円' ? 100_000_000 : 1;
      out.push({ kind: 'threshold', text: u[0], start: start + u.index, end: start + u.index + u[0].length, value: { number: n * mult, unit: u[2] === '万円' || u[2] === '億円' ? '円' : u[2] } });
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}
