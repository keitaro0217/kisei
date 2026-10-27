import { randomUUID } from 'node:crypto';
import type { TokenUsage, UsageRecord, UsageTotals } from '@/lib/research/types';
import { LlmError } from '../llm/errors';
import { appendJsonl, emptyTotals, getState, readJsonl, updateState } from '../storage/store';
import { computeCostUsd, findPrice } from './pricing';

export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

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

type RecordInput = Omit<UsageRecord, 'id' | 'at' | 'costUsd' | 'priceSource'>;

/** API呼び出し1回分の使用量を記録し、月次・実験ごとの集計を更新する */
export async function recordUsage(input: RecordInput): Promise<UsageRecord> {
  const record = await updateState((state) => {
    const price = input.ok ? findPrice(state.prices, input.providerId, input.model) : null;
    const costUsd = input.ok ? computeCostUsd(price, input.usage) : 0;
    const rec: UsageRecord = {
      ...input,
      id: randomUUID(),
      at: new Date().toISOString(),
      costUsd,
      priceSource: price?.source ?? null,
    };
    if (input.ok) {
      const month = monthKey();
      const byProvider = (state.usageMonthly[month] ??= {});
      addToTotals((byProvider[input.providerId] ??= emptyTotals()), input.usage, costUsd);
      if (input.experimentId) {
        const exp = state.experiments.find((e) => e.id === input.experimentId);
        if (exp) addToTotals(exp.usage, input.usage, costUsd);
      }
    }
    return rec;
  });
  await appendJsonl('usage.jsonl', record);
  return record;
}

export async function monthlyTotals(month = monthKey()): Promise<{ byProvider: Record<string, UsageTotals>; total: UsageTotals }> {
  const state = await getState();
  const byProvider = state.usageMonthly[month] ?? {};
  const total = emptyTotals();
  for (const t of Object.values(byProvider)) mergeTotals(total, t);
  return { byProvider, total };
}

/** 予算上限の確認。上限に達していれば budget_exceeded を投げる */
export async function assertWithinBudget(providerId: string): Promise<void> {
  const state = await getState();
  const provider = state.providers.find((p) => p.id === providerId);
  const { byProvider, total } = await monthlyTotals();
  if (provider?.monthlyBudgetUsd != null && (byProvider[providerId]?.costUsd ?? 0) >= provider.monthlyBudgetUsd) {
    throw new LlmError('budget_exceeded', `「${provider.name}」の月間予算（$${provider.monthlyBudgetUsd}）に達しました。`);
  }
  const global = state.settings.cost.globalMonthlyBudgetUsd;
  if (global != null && total.costUsd >= global) {
    throw new LlmError('budget_exceeded', `全体の月間予算（$${global}）に達しました。`);
  }
}

/** 予算が設定されているのに単価が無い場合、費用を管理できないため実行を止める */
export async function assertPricedWhenBudgeted(providerId: string, model: string): Promise<void> {
  const state = await getState();
  const provider = state.providers.find((p) => p.id === providerId);
  const budgeted = provider?.monthlyBudgetUsd != null || state.settings.cost.globalMonthlyBudgetUsd != null;
  if (budgeted && !findPrice(state.prices, providerId, model)) {
    throw new LlmError(
      'budget_exceeded',
      `予算上限が設定されていますが、モデル「${model}」の単価が未設定のため費用を管理できません。費用管理画面で単価を登録してください。`,
    );
  }
}

export async function listUsageHistory(limit = 200): Promise<UsageRecord[]> {
  const all = await readJsonl<UsageRecord>('usage.jsonl');
  return all.slice(-limit).reverse();
}
