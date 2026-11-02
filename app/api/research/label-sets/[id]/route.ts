import { apiError, json, withAuth } from '@/lib/server/api';
import { getLabelSet, listLabels, validateLabelSet } from '@/lib/server/research/eval/validationService';

/** データセットの詳細と、評価器の検証結果（正解ラベルに対する指標） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    if (!(await getLabelSet(id))) return apiError(404, 'not_found', 'データセットが見つかりません。');
    const [validation, labels] = await Promise.all([validateLabelSet(id), listLabels(id)]);
    return json({ ...validation, labels: labels.slice(0, 500) });
  });
}
