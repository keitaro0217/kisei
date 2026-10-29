import { json, readJson, withAuth } from '@/lib/server/api';
import { sendSampleEvents } from '@/lib/server/research/monitor/monitor';

/** サンプルイベントの送信（モック接続。サンプルと明示して保存する） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const { count } = await readJson(request);
    return json(await sendSampleEvents(id, Number(count ?? 20), principal));
  });
}
