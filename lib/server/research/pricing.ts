import type { ModelPrice, TokenUsage } from '@/lib/research/types';

// 料金は管理者が入力した単価（出典つき）のみを使用する。単価が無い場合は null を返し、
// 推測値を費用として表示しない。

export function findPrice(prices: ModelPrice[], providerId: string, model: string): ModelPrice | null {
  return prices.find((p) => p.providerId === providerId && p.model === model) ?? null;
}

export function computeCostUsd(price: ModelPrice | null, usage: TokenUsage): number | null {
  if (!price) return null;
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const cacheWrite = Math.min(usage.cacheWriteTokens, usage.inputTokens - cached);
  const uncached = Math.max(0, usage.inputTokens - cached - cacheWrite);
  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok;
  const writeRate = price.cacheWritePerMTok ?? price.inputPerMTok;
  const cost =
    (uncached * price.inputPerMTok + cached * cachedRate + cacheWrite * writeRate + usage.outputTokens * price.outputPerMTok) / 1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
