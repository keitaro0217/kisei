import { json, readJson, withAuth } from '@/lib/server/api';
import { createPoc, listPocs } from '@/lib/server/research/poc/poc';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ pocs: await listPocs() }));
}

export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ poc: await createPoc(await readJson(request), principal) }, 201));
}
