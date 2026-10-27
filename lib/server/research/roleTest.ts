import { roleLabels } from '@/lib/research/labels';
import type { ResearchRole } from '@/lib/research/types';
import { invokeModel } from '../llm/client';
import { LlmError } from '../llm/errors';
import { getConfig } from '../storage/store';
import { buildRuleDocument } from './sim/market';

// 役割ごとの割り当て確認用に、その役割らしい小さなタスクを1回実行する。
const TASKS: Record<ResearchRole, { system: string; user: (doc: string) => string }> = {
  trading_agent: {
    system: 'あなたは仮想市場の取引エージェントです。JSONのみで回答してください。',
    user: (doc) => `${doc}\n\n現在価格1000、現金100000、保有0株です。{"action","quantity","referenced_rules","rationale"} のJSONで判断してください。`,
  },
  llm_judge: {
    system: 'あなたは取引判断の評価者です。JSONのみで回答してください。',
    user: (doc) => `${doc}\n\n判断: 150株を購入（根拠条文なし）。{"score":1-5,"summary","issues":[]} で評価してください。`,
  },
  auto_patch: {
    system: 'あなたは規則文書の改善案を作成する担当者です。',
    user: (doc) => `${doc}\n\nこの規則の曖昧な点を1つ挙げ、修正後の条文案を1つ示してください（200字以内）。`,
  },
  document_analysis: {
    system: 'あなたは規制文書の構造を分析する担当者です。',
    user: (doc) => `${doc}\n\nこの文書の条文構造（条番号と要旨）を箇条書きで要約してください（200字以内）。`,
  },
};

export async function runRoleTest(role: ResearchRole) {
  const state = await getConfig();
  const assignment = state.roles[role];
  if (!assignment.providerId || !assignment.model) {
    throw new LlmError('not_configured', `「${roleLabels[role].label}」のプロバイダーとモデルを設定してください。`);
  }
  const doc = buildRuleDocument({ maxOrderQuantity: 100, maxPosition: 500, allowShortSelling: false });
  const task = TASKS[role];
  const res = await invokeModel({
    providerId: assignment.providerId,
    model: assignment.model,
    reasoning: assignment.reasoning,
    maxOutputTokens: assignment.maxOutputTokens,
    system: task.system,
    user: task.user(doc),
    purpose: role,
  });
  return { text: res.text.slice(0, 2000), usage: res.usage, costUsd: res.record.costUsd, latencyMs: res.latencyMs };
}
