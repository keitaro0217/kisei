import type { TokenUsage, UsageTotals } from '@/lib/research/types';

export const emptyTotals = (): UsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  unpricedCalls: 0,
});

export function addToTotals(totals: UsageTotals, usage: TokenUsage, costUsd: number | null) {
  totals.calls += 1;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.cachedTokens += usage.cachedTokens;
  totals.cacheWriteTokens += usage.cacheWriteTokens;
  totals.reasoningTokens += usage.reasoningTokens ?? 0;
  if (costUsd === null) totals.unpricedCalls += 1;
  else totals.costUsd = Math.round((totals.costUsd + costUsd) * 1e8) / 1e8;
}

export function mergeTotals(target: UsageTotals, add: UsageTotals) {
  target.calls += add.calls;
  target.inputTokens += add.inputTokens;
  target.outputTokens += add.outputTokens;
  target.cachedTokens += add.cachedTokens;
  target.cacheWriteTokens += add.cacheWriteTokens;
  target.reasoningTokens += add.reasoningTokens;
  target.costUsd = Math.round((target.costUsd + add.costUsd) * 1e8) / 1e8;
  target.unpricedCalls += add.unpricedCalls;
}
