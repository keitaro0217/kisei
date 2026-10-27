import type { ModelInfo, ProviderType, ReasoningSettings, TokenUsage } from '@/lib/research/types';

export type ProviderRuntime = {
  type: ProviderType;
  baseUrl: string;
  /** 復号済みAPIキー。メモリ上でのみ扱い、ログ・応答に含めない */
  apiKey: string | null;
  timeoutMs: number;
};

export type ChatInput = {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  reasoning: ReasoningSettings;
};

export type ChatOutput = {
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
};

export interface ProviderAdapter {
  listModels(rt: ProviderRuntime): Promise<ModelInfo[]>;
  chat(rt: ProviderRuntime, input: ChatInput): Promise<ChatOutput>;
}
