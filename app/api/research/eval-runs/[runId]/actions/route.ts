import { apiError, json, readJson, withAuth } from '@/lib/server/api';
import { setEvalRunStatus } from '@/lib/server/research/eval/evaluation';
import { scheduleWork } from '@/lib/server/research/scheduler';

export const maxDuration = 300;

export async function POST(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { runId } = await ctx.params;
    const { action } = await readJson(request);
    if (action !== 'pause' && action !== 'resume') return apiError(400, 'validation_error', '操作が正しくありません。');
    await setEvalRunStatus(runId, action, principal);
    if (action === 'resume') scheduleWork(request);
    return json({ ok: true });
  });
}
