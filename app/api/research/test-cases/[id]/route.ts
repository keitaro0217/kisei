import { json, readJson, withAuth } from '@/lib/server/api';
import { reviewTestCase } from '@/lib/server/research/failure/failures';

/** テストケースの確認（承認には期待する趣旨の判定が必要） */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ testCase: await reviewTestCase(id, await readJson(request), principal) });
  });
}
