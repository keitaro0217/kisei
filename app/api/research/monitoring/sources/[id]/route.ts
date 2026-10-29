import { json, readJson, withAuth } from '@/lib/server/api';
import { updateSourceSettings } from '@/lib/server/research/monitor/monitor';

/** 接続元の設定（抽出率・上限・警告の閾値・保存期間・無効化） */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'settings:write', async (principal) => {
    const { id } = await ctx.params;
    return json({ source: await updateSourceSettings(id, await readJson(request), principal) });
  });
}
