import { randomUUID } from 'node:crypto';
import type { UsageRecord, UsageTotals } from '@/lib/research/types';
import { LlmError } from '../llm/errors';
import { getConfig, getMonthlyUsage, listUsageRecords, saveUsage } from '../storage/store';
import { computeCostUsd, findPrice } from './pricing';
import { addToTotals, emptyTotals, mergeTotals } from './totals';

export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

export { addToTotals, emptyTotals, mergeTotals };

type RecordInput = Omit<UsageRecord, 'id' | 'at' | 'costUsd' | 'priceSource'>;

/** API呼び出し1回分の使用量を記録し、月次・実験ごとの集計を更新する */
export async function recordUsage(input: RecordInput): Promise<UsageRecord> {
  const config = await getConfig();
  const price = input.ok ? findPrice(config.prices, input.providerId, input.model) : null;
  const record: UsageRecord = {
    ...input,
    id: randomUUID(),
    at: new Date().toISOString(),
    costUsd: input.ok ? computeCostUsd(price, input.usage) : 0,
    priceSource: price?.source ?? null,
  };
  await saveUsage(record);
  return record;
}

export async function monthlyTotals(month = monthKey()): Promise<{ byProvider: Record<string, UsageTotals>; total: UsageTotals }> {
  const byProvider = await getMonthlyUsage(month);
  const total = emptyTotals();
  for (const t of Object.values(byProvider)) mergeTotals(total, t);
  return { byProvider, total };
}

/** 予算上限の確認。上限に達していれば budget_exceeded を投げる */
export async function assertWithinBudget(providerId: string): Promise<void> {
  const state = await getConfig();
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
  const state = await getConfig();
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
  return listUsageRecords(limit);
}
