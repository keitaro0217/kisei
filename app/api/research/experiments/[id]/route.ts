import { apiError, json, withAuth } from '@/lib/server/api';
import { getExperiment } from '@/lib/server/research/experiments';
import { scheduleWork } from '@/lib/server/research/scheduler';

export const maxDuration = 300;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 200) || 200, 2000);
    const data = await getExperiment(id, limit);
    if (!data) return apiError(404, 'not_found', '実験が見つかりません。');
    // 処理の引き継ぎが途切れていても、画面を開いている間は処理が進むようにする（担当中のワーカーがいれば何もしない）
    if (['running', 'pausing', 'stopping'].includes(data.experiment.status)) scheduleWork(request);
    return json(data);
  });
}
