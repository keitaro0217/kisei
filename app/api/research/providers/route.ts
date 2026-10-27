import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { createProvider, listProviders } from '@/lib/server/research/providers';

export async function GET(request: Request) {
  return withAuth(request, 'settings:read', async () => json({ providers: await listProviders() }));
}

export async function POST(request: Request) {
  return withAuth(request, 'settings:write', async (principal) => {
    const provider = await createProvider(await readJson(request));
    await audit(principal, 'provider.create', provider.id, 'success', `${provider.name}（${provider.type}）`);
    return json({ provider }, 201);
  });
}
