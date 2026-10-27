import type { ModelInfo } from '@/lib/research/types';
import { LlmError } from '../errors';
import type { ChatInput, ChatOutput, ProviderAdapter, ProviderRuntime } from '../types';
import { joinUrl, num, sendJson } from './transport';

// Anthropic Claude API（Messages API）
type ModelsResponse = {
  data?: { id: string; display_name?: string; max_tokens?: number; capabilities?: Record<string, unknown> }[];
  has_more?: boolean;
  last_id?: string | null;
};
type MessagesResponse = {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

function headers(rt: ProviderRuntime): Record<string, string> {
  return { 'x-api-key': rt.apiKey ?? '', 'anthropic-version': '2023-06-01' };
}

function readsThinking(capabilities: Record<string, unknown> | undefined): boolean | null {
  if (!capabilities) return null;
  const thinking = capabilities.thinking as { supported?: boolean } | undefined;
  const effort = capabilities.effort as { supported?: boolean } | undefined;
  if (thinking?.supported !== undefined || effort?.supported !== undefined) {
    return Boolean(thinking?.supported || effort?.supported);
  }
  return null;
}

export const anthropicAdapter: ProviderAdapter = {
  async listModels(rt) {
    const models: ModelInfo[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const query = `models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
      const json: ModelsResponse = await sendJson<ModelsResponse>(rt, 'GET', joinUrl(rt.baseUrl, `v1/${query}`), headers(rt));
      for (const m of json.data ?? []) {
        models.push({
          id: m.id,
          displayName: m.display_name ?? null,
          maxOutputTokens: typeof m.max_tokens === 'number' ? m.max_tokens : null,
          supportsReasoning: readsThinking(m.capabilities),
        });
      }
      if (!json.has_more || !json.last_id) break;
      after = json.last_id;
    }
    return models;
  },

  async chat(rt, input: ChatInput): Promise<ChatOutput> {
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: input.maxOutputTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    };
    // 推論の深さは output_config.effort で指定する（thinking はモデル既定に任せる）
    if (input.reasoning.effort) body.output_config = { effort: input.reasoning.effort };

    const json = await sendJson<MessagesResponse>(rt, 'POST', joinUrl(rt.baseUrl, 'v1/messages'), headers(rt), body);
    if (json.stop_reason === 'refusal') throw new LlmError('refusal', 'モデルが応答を拒否しました。');
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    const u = json.usage ?? {};
    const cacheRead = num(u.cache_read_input_tokens);
    const cacheWrite = num(u.cache_creation_input_tokens);
    return {
      text,
      stopReason: json.stop_reason ?? null,
      usage: {
        // input_tokens はキャッシュ分を含まないため合算して総入力とする
        inputTokens: num(u.input_tokens) + cacheRead + cacheWrite,
        outputTokens: num(u.output_tokens),
        cachedTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        // Messages API は思考トークン数を個別に返さない
        reasoningTokens: null,
      },
    };
  },
};
