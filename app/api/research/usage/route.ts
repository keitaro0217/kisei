import { json, withAuth } from '@/lib/server/api';
import { getState } from '@/lib/server/storage/store';
import { listUsageHistory, monthKey, monthlyTotals } from '@/lib/server/research/usage';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const url = new URL(request.url);
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') ?? '') ? url.searchParams.get('month')! : monthKey();
    const state = await getState();
    const { byProvider, total } = await monthlyTotals(month);
    return json({
      month,
      months: Object.keys(state.usageMonthly).sort().reverse(),
      byProvider,
      total,
      budgets: {
        global: state.settings.cost.globalMonthlyBudgetUsd,
        providers: Object.fromEntries(state.providers.map((p) => [p.id, p.monthlyBudgetUsd])),
      },
      history: await listUsageHistory(200),
    });
  });
}
