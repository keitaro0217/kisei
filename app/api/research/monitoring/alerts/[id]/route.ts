import { json, readJson, withAuth } from '@/lib/server/api';
import { setAlertStatus } from '@/lib/server/research/monitor/monitor';
import type { MonitorAlert } from '@/lib/research/monitor-types';

/** 警告の確認・解決 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const { status } = await readJson(request);
    return json({ alert: await setAlertStatus(id, status as MonitorAlert['status'], principal) });
  });
}
