import { json, withAuth } from '@/lib/server/api';
import { estimateStudy } from '@/lib/server/research/study/operations';

/** API 費用の事前見積もり（開始前は全体、開始後は残りのセッションの分） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    return json({ estimate: await estimateStudy(id) });
  });
}
