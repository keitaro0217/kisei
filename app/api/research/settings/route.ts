import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { getSettings, updateSettings } from '@/lib/server/research/settings';

export async function GET(request: Request) {
  return withAuth(request, 'settings:read', async () => json({ settings: await getSettings() }));
}

export async function PUT(request: Request) {
  return withAuth(request, 'settings:write', async (principal) => {
    const body = await readJson(request);
    const settings = await updateSettings(body);
    await audit(principal, 'settings.update', Object.keys(body).join(','), 'success');
    return json({ settings });
  });
}
