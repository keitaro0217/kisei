import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { updateRole } from '@/lib/server/research/settings';

export async function PUT(request: Request, ctx: { params: Promise<{ role: string }> }) {
  return withAuth(request, 'settings:write', async (principal) => {
    const { role } = await ctx.params;
    const assignment = await updateRole(role, await readJson(request));
    await audit(principal, 'role.update', role, 'success', `${assignment.providerId ?? '-'} / ${assignment.model ?? '-'}`);
    return json({ role: assignment });
  });
}
