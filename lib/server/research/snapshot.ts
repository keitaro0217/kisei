import { createHash } from 'node:crypto';
import { canonical } from '../util/canonical';
import { apiKeyRequired, roleLabels } from '@/lib/research/labels';
import type { ExperimentSnapshot, MarketConfig, ResearchRole, RoleSnapshot } from '@/lib/research/types';
import { LlmError } from '../llm/errors';
import { getConfig, type Config } from '../storage/store';
import { buildRuleDocument, RULE_DOCUMENT_VERSION } from './sim/market';
import { DECISION_FORMAT, JUDGE_SYSTEM, PROMPT_VERSION, TOOL_VERSION, TRADING_AGENT_SYSTEM } from './sim/prompts';

/**
 * 指定したプロバイダーとモデルの設定を固定する（APIキーは含めない）。
 * 研究での利用が無効なプロバイダー・APIキーのないプロバイダーは使えない。
 */
export function providerSnapshot(state: Config, providerId: string, model: string, opts: { label: string; maxOutputTokens: number; reasoning?: RoleSnapshot['reasoning'] }): RoleSnapshot {
  const provider = state.providers.find((p) => p.id === providerId);
  if (!provider) throw new LlmError('not_configured', `「${opts.label}」に指定した接続先が見つかりません（削除された可能性があります）。`);
  if (provider.researchEnabled === false) {
    throw new LlmError('not_configured', `「${provider.name}」は研究での利用が無効になっています。設定 → API連携で有効にしてください。`);
  }
  if (apiKeyRequired[provider.type] && !provider.encryptedApiKey) {
    throw new LlmError('not_configured', `「${provider.name}」のAPIキーが登録されていません。設定 → API連携で登録してください。`);
  }
  if (provider.connection.status === 'failed') {
    throw new LlmError('not_configured', `「${provider.name}」は前回の接続テストに失敗しています。設定 → API連携で接続テストを実行し、成功してから開始してください。`);
  }
  return {
    providerId: provider.id,
    providerType: provider.type,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    model,
    reasoning: structuredClone(opts.reasoning ?? {}),
    maxOutputTokens: opts.maxOutputTokens,
  };
}

/** 用途（役割）のモデル設定を固定する。用途の割り当てがなければ kisei 全体のデフォルトのモデルを使う */
export function roleSnapshot(state: Config, role: ResearchRole): RoleSnapshot {
  const assignment = state.roles[role];
  const label = roleLabels[role].label;
  if (assignment.providerId && assignment.model) {
    return providerSnapshot(state, assignment.providerId, assignment.model, { label, maxOutputTokens: assignment.maxOutputTokens, reasoning: assignment.reasoning });
  }
  if (state.defaultModel) {
    return providerSnapshot(state, state.defaultModel.providerId, state.defaultModel.model, { label, maxOutputTokens: assignment.maxOutputTokens });
  }
  throw new LlmError('not_configured', `「${label}」に使うモデルが設定されていません。設定 → API連携でAPIキーを登録し、デフォルトのモデルを選んでください。`);
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
