import { json, readJson, withAuth } from '@/lib/server/api';
import { decidePolicyIntent } from '@/lib/server/domain/studio';

/** 規則の目的の候補を承認・却下する（AI だけでは確定しない） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ intent: await decidePolicyIntent(id, await readJson(request), principal) });
  });
}
