import { apiError, json, withAuth } from '@/lib/server/api';
import { getReviewQueue } from '@/lib/server/research/eval/evaluation';

/** 人の評価の対象（評価が割れている判断を優先） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const q = new URL(request.url).searchParams;
    const data = await getReviewQueue(id, {
      offset: Math.max(Number(q.get('offset') ?? 0) || 0, 0),
      limit: Math.min(Math.max(Number(q.get('limit') ?? 1) || 1, 1), 50),
      annotator: q.get('annotator')?.slice(0, 40) || null,
      onlyUnreviewed: q.get('unreviewed') === '1',
    });
    if (!data) return apiError(404, 'not_found', '開始済みの研究が見つかりません。');
    return json(data);
  });
}
