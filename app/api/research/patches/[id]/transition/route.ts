import { json, readJson, withAuth } from '@/lib/server/api';
import { transitionPatch } from '@/lib/server/research/patch/patches';

/** 修正案の状態の変更（研究者による承認・却下）。本番の規則・業務への適用は行わない */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ patch: await transitionPatch(id, await readJson(request), principal) });
  });
}
