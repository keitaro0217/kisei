import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { runConnectionTest } from '@/lib/server/research/connectionTest';
import { getProviderRecord, toDTO } from '@/lib/server/research/providers';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'settings:write', async (principal) => {
    const { id } = await ctx.params;
    const { model } = await readJson(request);
    const result = await runConnectionTest(id, typeof model === 'string' ? model : null);
    await audit(principal, 'provider.test', id, result.ok ? 'success' : 'failure', result.message);
    const record = await getProviderRecord(id);
    return json({ result, provider: record ? toDTO(record) : null });
  });
}
