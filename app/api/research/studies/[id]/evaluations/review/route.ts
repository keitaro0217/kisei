import { json, readJson, withAuth } from '@/lib/server/api';
import { reviewEvaluation } from '@/lib/server/research/eval/validationService';

/** 評価器の判定を人が承認・修正・却下する（履歴は追記のみ） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ review: await reviewEvaluation(id, await readJson(request), principal) }, 201);
  });
}
