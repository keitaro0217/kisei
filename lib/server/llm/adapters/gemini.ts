import type { ModelInfo } from '@/lib/research/types';
import { LlmError } from '../errors';
import type { ChatInput, ChatOutput, ProviderAdapter, ProviderRuntime } from '../types';
import { joinUrl, num, sendJson } from './transport';

// Google Gemini API（generateContent）
type ModelsResponse = {
  models?: {
    name: string;
    displayName?: string;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
    thinking?: boolean;
  }[];
  nextPageToken?: string;
};
type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

function headers(rt: ProviderRuntime): Record<string, string> {
  return { 'x-goog-api-key': rt.apiKey ?? '' };
}

const stripPrefix = (name: string) => name.replace(/^models\//, '');

export const geminiAdapter: ProviderAdapter = {
  async listModels(rt) {
    const models: ModelInfo[] = [];
    let token: string | undefined;
    for (let page = 0; page < 10; page++) {
      const query = `models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
      const json: ModelsResponse = await sendJson<ModelsResponse>(rt, 'GET', joinUrl(rt.baseUrl, query), headers(rt));
      for (const m of json.models ?? []) {
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
        models.push({
          id: stripPrefix(m.name),
          displayName: m.displayName ?? null,
          maxOutputTokens: typeof m.outputTokenLimit === 'number' ? m.outputTokenLimit : null,
          supportsReasoning: typeof m.thinking === 'boolean' ? m.thinking : null,
        });
      }
      if (!json.nextPageToken) break;
      token = json.nextPageToken;
    }
    return models;
  },

  async chat(rt, input: ChatInput): Promise<ChatOutput> {
    const generationConfig: Record<string, unknown> = { maxOutputTokens: input.maxOutputTokens };
    if (typeof input.reasoning.thinkingBudget === 'number') {
      generationConfig.thinkingConfig = { thinkingBudget: input.reasoning.thinkingBudget };
    }
    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.user }] }],
      generationConfig,
    };
    const path = `models/${encodeURIComponent(stripPrefix(input.model))}:generateContent`;
    const json = await sendJson<GenerateResponse>(rt, 'POST', joinUrl(rt.baseUrl, path), headers(rt), body);
    if (json.promptFeedback?.blockReason) throw new LlmError('refusal', `入力がブロックされました（${json.promptFeedback.blockReason}）。`);
    const candidate = json.candidates?.[0];
    if (!candidate) throw new LlmError('invalid_response', '応答に候補が含まれていません。');
    if (candidate.finishReason === 'SAFETY') throw new LlmError('refusal', '安全性フィルターにより応答が停止されました。');
    const text = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    const u = json.usageMetadata ?? {};
    const thoughts = num(u.thoughtsTokenCount);
    return {
      text,
      stopReason: candidate.finishReason ?? null,
      usage: {
        inputTokens: num(u.promptTokenCount),
        // 思考トークンは出力として課金されるため出力に含める
        outputTokens: num(u.candidatesTokenCount) + thoughts,
        cachedTokens: num(u.cachedContentTokenCount),
        cacheWriteTokens: 0,
        reasoningTokens: u.thoughtsTokenCount === undefined ? null : thoughts,
      },
    };
  },
};
