import { json, readJson, withAuth } from '@/lib/server/api';
import { reviewRulePair } from '@/lib/server/research/study/rules';

/** 研究者による等価性・差分分類の確認 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ pair: await reviewRulePair(id, await readJson(request), principal) });
  });
}
