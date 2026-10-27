import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { deletePrice, listPrices, upsertPrice } from '@/lib/server/research/settings';

export async function GET(request: Request) {
  return withAuth(request, 'settings:read', async () => json({ prices: await listPrices() }));
}

export async function PUT(request: Request) {
  return withAuth(request, 'settings:write', async (principal) => {
    const price = await upsertPrice(await readJson(request));
    await audit(principal, 'pricing.upsert', `${price.providerId}/${price.model}`, 'success', `入力 $${price.inputPerMTok} / 出力 $${price.outputPerMTok}（出典: ${price.source}）`);
    return json({ price });
  });
}

export async function DELETE(request: Request) {
  return withAuth(request, 'settings:write', async (principal) => {
    const url = new URL(request.url);
    const providerId = url.searchParams.get('providerId') ?? '';
    const model = url.searchParams.get('model') ?? '';
    await deletePrice(providerId, model);
    await audit(principal, 'pricing.delete', `${providerId}/${model}`, 'success');
    return json({ ok: true });
  });
}
