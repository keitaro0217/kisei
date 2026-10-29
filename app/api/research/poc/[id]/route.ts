import { apiError, json, readJson, withAuth } from '@/lib/server/api';
import { computePocMetrics, getPoc, updatePoc } from '@/lib/server/research/poc/poc';

/** PoC と、研究データから集計した指標 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const poc = await getPoc(id);
    if (!poc) return apiError(404, 'not_found', 'PoC が見つかりません。');
    return json({ poc, metrics: await computePocMetrics(poc) });
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    const poc = await updatePoc(id, await readJson(request), principal);
    return json({ poc, metrics: await computePocMetrics(poc) });
  });
}
