import { apiError, json, readJson, withAuth } from '@/lib/server/api';
import { evaluateHypothesis, scheduleExperiment } from '@/lib/server/research/failure/rootCause';
import { scheduleWork } from '@/lib/server/research/scheduler';

export const maxDuration = 300;

/** 検証実験の作成（schedule）と、結果による仮説の評価（evaluate） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (body.action === 'schedule') {
      const hypothesis = await scheduleExperiment(id, body, principal);
      if (body.start === true) scheduleWork(request);
      return json({ hypothesis });
    }
    if (body.action === 'evaluate') return json({ hypothesis: await evaluateHypothesis(id, principal) });
    return apiError(400, 'validation_error', '操作が正しくありません。');
  });
}
