import { json, withAuth } from '@/lib/server/api';
import { listAudit } from '@/lib/server/audit';
import { getSecurityStatus } from '@/lib/server/research/security';

export async function GET(request: Request) {
  return withAuth(request, 'audit:read', async () => json({ status: await getSecurityStatus(), audit: await listAudit(200) }));
}
