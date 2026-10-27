import { json, withAuth } from '@/lib/server/api';
import { listProviders } from '@/lib/server/research/providers';
import { monthlyTotals } from '@/lib/server/research/usage';
import { listExperiments } from '@/lib/server/research/experiments';
import { getConfig } from '@/lib/server/storage/store';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const state = await getConfig();
    const experiments = await listExperiments();
    const { total } = await monthlyTotals();
    return json({
      providers: await listProviders(),
      roles: state.roles,
      experiments: experiments.slice(0, 10),
      runningCount: experiments.filter((e) => e.status === 'running' || e.status === 'pausing').length,
      month: total,
      globalBudget: state.settings.cost.globalMonthlyBudgetUsd,
      settings: state.settings,
    });
  });
}
