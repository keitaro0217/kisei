import { json, withAuth } from '@/lib/server/api';
import { getRoles } from '@/lib/server/research/settings';

export async function GET(request: Request) {
  return withAuth(request, 'settings:read', async () => json({ roles: await getRoles() }));
}
