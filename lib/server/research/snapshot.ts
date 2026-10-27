import { createHash } from 'node:crypto';
import { apiKeyRequired, roleLabels } from '@/lib/research/labels';
import type { ExperimentSnapshot, MarketConfig, ResearchRole, RoleSnapshot } from '@/lib/research/types';
import { LlmError } from '../llm/errors';
import { getConfig, type Config } from '../storage/store';
import { buildRuleDocument, RULE_DOCUMENT_VERSION } from './sim/market';
import { DECISION_FORMAT, JUDGE_SYSTEM, PROMPT_VERSION, TOOL_VERSION, TRADING_AGENT_SYSTEM } from './sim/prompts';

function roleSnapshot(state: Config, role: ResearchRole): RoleSnapshot {
  const assignment = state.roles[role];
  const label = roleLabels[role].label;
  if (!assignment.providerId || !assignment.model) {
    throw new LlmError('not_configured', `「${label}」のプロバイダーとモデルが設定されていません。設定 → モデル割り当てで設定してください。`);
  }
  const provider = state.providers.find((p) => p.id === assignment.providerId);
  if (!provider) throw new LlmError('not_configured', `「${label}」に割り当てたプロバイダーが見つかりません。`);
  if (apiKeyRequired[provider.type] && !provider.encryptedApiKey) {
    throw new LlmError('not_configured', `「${provider.name}」のAPIキーが登録されていません。設定 → API連携で登録してください。`);
  }
  return {
    providerId: provider.id,
    providerType: provider.type,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    model: assignment.model,
    reasoning: structuredClone(assignment.reasoning),
    maxOutputTokens: assignment.maxOutputTokens,
  };
}

/** 実験開始時点のモデル設定・プロンプト・ツール構成を固定する（APIキーは含めない） */
export async function buildSnapshot(market: MarketConfig, judgeEnabled: boolean): Promise<ExperimentSnapshot> {
  const state = await getConfig();
  const trading = roleSnapshot(state, 'trading_agent');
  const judge = judgeEnabled ? roleSnapshot(state, 'llm_judge') : null;
  const tradingProvider = state.providers.find((p) => p.id === trading.providerId)!;
  return {
    roles: { trading_agent: trading, llm_judge: judge },
    prompts: { tradingAgentSystem: TRADING_AGENT_SYSTEM, judgeSystem: JUDGE_SYSTEM, promptVersion: PROMPT_VERSION },
    tools: { decisionFormat: DECISION_FORMAT, toolVersion: TOOL_VERSION },
    market: structuredClone(market),
    ruleDocument: buildRuleDocument(market.rules),
    operational: {
      timeoutMs: tradingProvider.timeoutMs,
      maxRetries: tradingProvider.maxRetries,
      episodeConcurrency: state.settings.execution.episodeConcurrency,
      episodeRetries: state.settings.execution.episodeRetries,
      maxConsecutiveFailures: state.settings.execution.maxConsecutiveFailures,
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 研究条件（モデル・推論設定・プロンプト・ツール構成・市場条件・規則文書）のハッシュ。
 * これが異なる実験は別の実験バージョンとして扱う。APIキーや運用設定は含めない。
 */
export function versionHashOf(snapshot: ExperimentSnapshot): string {
  const roleKey = (r: RoleSnapshot | null) =>
    r && { providerType: r.providerType, baseUrl: r.baseUrl, model: r.model, reasoning: r.reasoning, maxOutputTokens: r.maxOutputTokens };
  const research = {
    roles: { trading_agent: roleKey(snapshot.roles.trading_agent), llm_judge: roleKey(snapshot.roles.llm_judge) },
    prompts: snapshot.prompts,
    tools: snapshot.tools,
    market: snapshot.market,
    ruleDocument: snapshot.ruleDocument,
    ruleVersion: RULE_DOCUMENT_VERSION,
  };
  return createHash('sha256').update(canonical(research)).digest('hex').slice(0, 16);
}
