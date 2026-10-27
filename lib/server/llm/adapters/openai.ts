import type { ModelInfo } from '@/lib/research/types';
import { LlmError } from '../errors';
import type { ChatInput, ChatOutput, ProviderAdapter, ProviderRuntime } from '../types';
import { joinUrl, num, numOrNull, sendJson } from './transport';

// OpenAI API と OpenAI互換API（Chat Completions 形式）
type ModelsResponse = { data?: { id: string; owned_by?: string }[] };
type ChatResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

function authHeaders(rt: ProviderRuntime): Record<string, string> {
  return rt.apiKey ? { authorization: `Bearer ${rt.apiKey}` } : {};
}

export function createOpenAiAdapter(compatible: boolean): ProviderAdapter {
  return {
    async listModels(rt) {
      const json = await sendJson<ModelsResponse>(rt, 'GET', joinUrl(rt.baseUrl, 'models'), authHeaders(rt));
      return (json.data ?? [])
        .filter((m) => typeof m.id === 'string')
        .map<ModelInfo>((m) => ({ id: m.id, displayName: null, maxOutputTokens: null, supportsReasoning: null }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async chat(rt, input: ChatInput): Promise<ChatOutput> {
      const body: Record<string, unknown> = {
        model: input.model,
        messages: [
          { role: compatible ? 'system' : 'developer', content: input.system },
          { role: 'user', content: input.user },
        ],
      };
      // OpenAI 本家は max_completion_tokens、互換APIは広く使われている max_tokens を送る
      body[compatible ? 'max_tokens' : 'max_completion_tokens'] = input.maxOutputTokens;
      if (input.reasoning.effort) body.reasoning_effort = input.reasoning.effort;

      const json = await sendJson<ChatResponse>(rt, 'POST', joinUrl(rt.baseUrl, 'chat/completions'), authHeaders(rt), body);
      const choice = json.choices?.[0];
      if (!choice) throw new LlmError('invalid_response', '応答に choices が含まれていません。');
      if (choice.message?.refusal) throw new LlmError('refusal', 'モデルが応答を拒否しました。');
      const usage = json.usage ?? {};
      return {
        text: choice.message?.content ?? '',
        stopReason: choice.finish_reason ?? null,
        usage: {
          inputTokens: num(usage.prompt_tokens),
          outputTokens: num(usage.completion_tokens),
          cachedTokens: num(usage.prompt_tokens_details?.cached_tokens),
          cacheWriteTokens: 0,
          reasoningTokens: numOrNull(usage.completion_tokens_details?.reasoning_tokens),
        },
      };
    },
  };
}
