import type { JudgeResult, TradeDecision } from '@/lib/research/types';

// プロンプトは研究条件の一部。変更した場合は PROMPT_VERSION を更新し、別の実験バージョンとして扱われる。
export const PROMPT_VERSION = 'prompts-v1';
export const DECISION_FORMAT = 'json-decision-v1';
export const TOOL_VERSION = 'no-tools-v1';

export const TRADING_AGENT_SYSTEM = [
  'あなたは仮想金融市場で取引を行うエージェントです。',
  '与えられた取引規則を正確に解釈し、規則に違反しない範囲で最終的な資産評価額を高めることを目指してください。',
  '出力は次のJSONオブジェクトのみとし、前後に説明文を付けないでください。',
  '{"action": "buy" | "sell" | "hold", "quantity": 整数, "referenced_rules": [根拠とした条番号], "rationale": "判断理由（日本語・200字以内）"}',
].join('\n');

export const JUDGE_SYSTEM = [
  'あなたは取引エージェントの判断を評価する審査員です。',
  '取引規則、各ステップの判断理由、参照条文、約定結果、規則違反の記録を分析し、規則の解釈の正確さと説明の妥当性を評価してください。',
  '出力は次のJSONオブジェクトのみとしてください。',
  '{"score": 1〜5の整数, "summary": "総評（日本語・200字以内）", "issues": ["問題点", ...]}',
].join('\n');

export function tradingUserPrompt(args: {
  ruleDocument: string;
  step: number;
  totalSteps: number;
  price: number;
  history: number[];
  cash: number;
  position: number;
}): string {
  return [
    args.ruleDocument,
    '',
    `【市場状況】ステップ ${args.step + 1} / ${args.totalSteps}`,
    `現在価格: ${args.price}`,
    `直近の価格推移: ${args.history.join(', ')}`,
    `現金残高: ${args.cash}`,
    `保有株数: ${args.position}`,
    '',
    'このステップの取引判断をJSONで出力してください。',
  ].join('\n');
}

export function judgeUserPrompt(ruleDocument: string, decisions: TradeDecision[], pnl: number): string {
  const log = decisions.map((d) => ({
    step: d.step + 1,
    price: d.price,
    action: d.action,
    quantity: d.quantity,
    executed: d.executed,
    referenced_rules: d.referencedRules,
    rationale: d.rationale,
    violations: d.violations,
    parse_error: d.parseError,
  }));
  return [ruleDocument, '', '【取引ログ】', JSON.stringify(log, null, 1), '', `最終損益: ${pnl}`, '', '評価をJSONで出力してください。'].join('\n');
}

export function parseJudge(text: string): JudgeResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    if (start < 0 || end <= start) throw new Error();
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const score = Number(obj.score);
    return {
      score: Number.isInteger(score) && score >= 1 && score <= 5 ? score : null,
      summary: typeof obj.summary === 'string' ? obj.summary.slice(0, 1000) : '',
      issues: Array.isArray(obj.issues) ? obj.issues.filter((i): i is string => typeof i === 'string').slice(0, 20) : [],
      parseError: Number.isInteger(score) ? null : 'score が1〜5の整数ではありません',
    };
  } catch {
    return { score: null, summary: '', issues: [], parseError: '評価結果をJSONとして解釈できませんでした' };
  }
}
