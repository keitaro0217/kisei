import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { deleteApiKey, setApiKey } from '@/lib/server/research/providers';

// APIキーの登録・更新・削除。応答にはマスク済みの値のみを含め、キー本体は返さない。

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'credentials:write', async (principal) => {
    const { id } = await ctx.params;
    const { apiKey } = await readJson(request, 4096);
    const provider = await setApiKey(id, apiKey);
    await audit(principal, 'credential.set', id, 'success', `${provider.name} のAPIキーを登録・更新しました`);
    return json({ provider });
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'credentials:write', async (principal) => {
    const { id } = await ctx.params;
    const provider = await deleteApiKey(id);
    await audit(principal, 'credential.delete', id, 'success', `${provider.name} のAPIキーを削除しました`);
    return json({ provider });
  });
}
