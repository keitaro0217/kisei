import { json, readJson, withAuth } from '@/lib/server/api';
import { reviewFailure } from '@/lib/server/research/failure/failures';

/** Failure の確認（状態・重大度・メモ） */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ failure: await reviewFailure(id, await readJson(request), principal) });
  });
}
