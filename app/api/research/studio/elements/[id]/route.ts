import { json, readJson, withAuth } from '@/lib/server/api';
import { reviewRuleElement } from '@/lib/server/domain/studio';

/** 規則の要素のレビュー（承認・却下・修正） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ element: await reviewRuleElement(id, await readJson(request), principal) });
  });
}
