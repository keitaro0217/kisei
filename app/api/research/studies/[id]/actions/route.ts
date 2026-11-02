import { apiError, json, readJson, withAuth } from '@/lib/server/api';
import { scheduleWork } from '@/lib/server/research/scheduler';
import { pauseStudy, resumeStudy, startStudy, stopStudy } from '@/lib/server/research/study/studies';
import { duplicateStudy, updateStudyBudget } from '@/lib/server/research/study/operations';
import { getStudy } from '@/lib/server/storage/studyStore';

export const maxDuration = 300;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    const action = body.action;
    // 複製: 新しい下書きを返す
    if (action === 'duplicate') return json({ study: await duplicateStudy(id, principal) }, 201);
    if (action === 'budget') return json({ study: await updateStudyBudget(id, body.maxCostUsd, principal) });
    if (action === 'start') await startStudy(id, principal);
    else if (action === 'pause') await pauseStudy(id, principal);
    else if (action === 'resume') await resumeStudy(id, principal);
    else if (action === 'stop') await stopStudy(id, principal);
    else return apiError(400, 'validation_error', '操作が正しくありません。');
    scheduleWork(request);
    return json({ study: await getStudy(id) });
  });
}
