import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { deleteProvider, updateProvider } from '@/lib/server/research/providers';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'settings:write', async (principal) => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    // APIキーはこのエンドポイントでは受け付けない（専用エンドポイントで暗号化して保存）
    delete body.apiKey;
    const provider = await updateProvider(id, body);
    await audit(principal, 'provider.update', id, 'success', Object.keys(body).join(','));
    return json({ provider });
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'settings:write', async (principal) => {
    const { id } = await ctx.params;
    await deleteProvider(id);
    await audit(principal, 'provider.delete', id, 'success');
    return json({ ok: true });
  });
}
