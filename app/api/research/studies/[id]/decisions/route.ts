import { json, withAuth } from '@/lib/server/api';
import { listDecisions } from '@/lib/server/storage/studyStore';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const q = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(q.get('limit') ?? 50) || 50, 1), 500);
    const offset = Math.max(Number(q.get('offset') ?? 0) || 0, 0);
    const conditionId = q.get('condition') || undefined;
    return json({ decisions: await listDecisions(id, { conditionId, limit, offset }) });
  });
}
