import { apiError, json, readJson, withAuth } from '@/lib/server/api';
import { getExperiment, pauseExperiment, resumeExperiment, stopExperiment } from '@/lib/server/research/experiments';
import { scheduleWork } from '@/lib/server/research/scheduler';

export const maxDuration = 300;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const { action } = await readJson(request);
    if (action === 'pause') await pauseExperiment(id, principal);
    else if (action === 'resume') await resumeExperiment(id, principal);
    else if (action === 'stop') await stopExperiment(id, principal);
    else return apiError(400, 'validation_error', '操作が正しくありません。');
    scheduleWork(request);
    const data = await getExperiment(id);
    return json({ experiment: data?.experiment ?? null });
  });
}
