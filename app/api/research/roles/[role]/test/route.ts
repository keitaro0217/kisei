import { researchRoles } from '@/lib/research/labels';
import type { ResearchRole } from '@/lib/research/types';
import { apiError, json, withAuth } from '@/lib/server/api';
import { runRoleTest } from '@/lib/server/research/roleTest';

export async function POST(request: Request, ctx: { params: Promise<{ role: string }> }) {
  return withAuth(request, 'research:run', async () => {
    const { role } = await ctx.params;
    if (!researchRoles.includes(role as ResearchRole)) return apiError(404, 'not_found', '役割が見つかりません。');
    return json({ result: await runRoleTest(role as ResearchRole) });
  });
}
