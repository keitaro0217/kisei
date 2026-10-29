import { json, readJson, withAuth } from '@/lib/server/api';
import { goldDataset, saveAnnotation } from '@/lib/server/research/eval/evaluation';

/** 研究用のゴールドデータ（人の評価）を JSON で出力する */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const body = JSON.stringify({ schema: 'kisei.gold-labels/v1', studyId: id, exportedAt: new Date().toISOString(), items: await goldDataset(id) }, null, 2);
    return new Response(body, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="gold-labels-${id.slice(0, 8)}.json"`, 'cache-control': 'no-store' },
    });
  });
}

/** 人の評価を保存する（同じ評価者の再評価は上書きし、履歴を残す） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ annotation: await saveAnnotation(id, await readJson(request), principal) }, 201);
  });
}
