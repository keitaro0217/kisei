import { json, withAuth } from '@/lib/server/api';
import { listEvents } from '@/lib/server/storage/monitorStore';

/** 接続元のイベント（ログイン中のテナントのものだけ） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async (principal) => {
    const { id } = await ctx.params;
    const q = new URL(request.url).searchParams;
    return json({ events: await listEvents(principal.tenantId, { sourceId: id, limit: Math.min(Number(q.get('limit') ?? 100) || 100, 500), flaggedOnly: q.get('flagged') === '1' }) });
  });
}
