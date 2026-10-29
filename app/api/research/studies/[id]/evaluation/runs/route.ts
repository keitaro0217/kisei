import { json, readJson, withAuth } from '@/lib/server/api';
import { createEvalRun } from '@/lib/server/research/eval/evaluation';
import { scheduleWork } from '@/lib/server/research/scheduler';

export const maxDuration = 300;

/** Judge による評価を開始する（モック、または設定 → モデル割り当ての「LLM Judge」） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const run = await createEvalRun(id, await readJson(request), principal);
    scheduleWork(request);
    const { sample, ...rest } = run;
    return json({ run: { ...rest, sampleSize: sample.length } }, 201);
  });
}
