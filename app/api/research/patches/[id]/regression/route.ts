import { json, readJson, withAuth } from '@/lib/server/api';
import { runRegression } from '@/lib/server/research/patch/regression';

export const maxDuration = 60;

/** 回帰テストの実行（保存したテストケースを修正前後の規則で決定論的に判定し直す） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ run: await runRegression(id, await readJson(request), principal) }, 201);
  });
}
