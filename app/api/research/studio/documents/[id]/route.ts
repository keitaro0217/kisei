import { apiError, json, withAuth } from '@/lib/server/api';
import { getRuleDocument } from '@/lib/server/domain/studio';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const d = await getRuleDocument(id);
    return d ? json(d) : apiError(404, 'not_found', '規則文書が見つかりません。');
  });
}
