import { json, readJson, withAuth } from '@/lib/server/api';
import { createRulePair, listPairs } from '@/lib/server/research/study/rules';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ pairs: await listPairs() }));
}

export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ pair: await createRulePair(await readJson(request), principal) }, 201));
}
