import { json, withAuth } from '@/lib/server/api';
import { getUnifiedEvaluation } from '@/lib/server/research/eval/validationService';

/** 評価の統合: 評価器ごとの判定（6分類）・複合評価・不一致の一覧 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const url = new URL(request.url);
    return json(await getUnifiedEvaluation(id, { limit: Number(url.searchParams.get('limit') ?? 100), onlyDisagreements: url.searchParams.get('disagreements') === '1' }));
  });
}
