import { json, readJson, withAuth } from '@/lib/server/api';
import { addLabels } from '@/lib/server/research/eval/validationService';

/** ラベルの登録（JSON の labels 配列、または csv 文字列） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json(await addLabels(id, await readJson(request, 2 * 1024 * 1024), principal), 201);
  });
}
