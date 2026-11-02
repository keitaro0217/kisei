import { apiError, json, readJson, withAuth } from '@/lib/server/api';
import { freezeSet, newVersion } from '@/lib/server/research/eval/validationService';

/** 固定（以後ラベルを変更できない）・新しい版の作成 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const { action } = await readJson(request);
    if (action === 'freeze') return json({ set: await freezeSet(id, principal) });
    if (action === 'new_version') return json({ set: await newVersion(id, principal) }, 201);
    return apiError(400, 'validation_error', '操作が正しくありません。');
  });
}
