import { apiError, json, withAuth } from '@/lib/server/api';
import { getExperiment } from '@/lib/server/research/experiments';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const data = await getExperiment(id);
    if (!data) return apiError(404, 'not_found', '実験が見つかりません。');
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 200) || 200, 2000);
    return json({ experiment: data.experiment, episodes: data.episodes.slice(-limit).reverse(), episodeCount: data.episodes.length });
  });
}
