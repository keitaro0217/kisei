import type { ModelInfo } from '@/lib/research/types';
import type { ChatInput, ChatOutput, ProviderAdapter, ProviderRuntime } from '../types';
import { joinUrl, num, sendJson } from './transport';

// ローカルLLM（Ollama ネイティブAPI）
type TagsResponse = { models?: { name: string; model?: string }[] };
type ChatResponse = {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

function headers(rt: ProviderRuntime): Record<string, string> {
  // 認証付きリバースプロキシの背後にある Ollama 用に、キーが登録されていれば送る
  return rt.apiKey ? { authorization: `Bearer ${rt.apiKey}` } : {};
}

export const ollamaAdapter: ProviderAdapter = {
  async listModels(rt) {
    const json = await sendJson<TagsResponse>(rt, 'GET', joinUrl(rt.baseUrl, 'api/tags'), headers(rt));
    return (json.models ?? []).map<ModelInfo>((m) => ({ id: m.name, displayName: null, maxOutputTokens: null, supportsReasoning: null }));
  },

  async chat(rt, input: ChatInput): Promise<ChatOutput> {
    const body = {
      model: input.model,
      stream: false,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      options: { num_predict: input.maxOutputTokens },
    };
    const json = await sendJson<ChatResponse>(rt, 'POST', joinUrl(rt.baseUrl, 'api/chat'), headers(rt), body);
    return {
      text: json.message?.content ?? '',
      stopReason: json.done_reason ?? null,
      usage: {
        inputTokens: num(json.prompt_eval_count),
        outputTokens: num(json.eval_count),
        cachedTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: null,
      },
    };
  },
};
