import { json, readJson, withAuth } from '@/lib/server/api';
import { startPatchExperiment } from '@/lib/server/research/patch/patches';
import { scheduleWork } from '@/lib/server/research/scheduler';

export const maxDuration = 300;

/** 修正前後を同じ市場・同じシードで比べる再実験 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    const patch = await startPatchExperiment(id, body, principal);
    if (body.start === true) scheduleWork(request);
    return json({ patch });
  });
}
