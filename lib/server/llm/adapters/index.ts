import type { ProviderType } from '@/lib/research/types';
import type { ProviderAdapter } from '../types';
import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { ollamaAdapter } from './ollama';
import { createOpenAiAdapter } from './openai';

const adapters: Record<ProviderType, ProviderAdapter> = {
  openai: createOpenAiAdapter(false),
  openai_compatible: createOpenAiAdapter(true),
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};

export const getAdapter = (type: ProviderType): ProviderAdapter => adapters[type];
