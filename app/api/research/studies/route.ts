import { json, readJson, withAuth } from '@/lib/server/api';
import { createStudy, listStudies } from '@/lib/server/research/study/studies';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ studies: await listStudies() }));
}

export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ study: await createStudy(await readJson(request, 128 * 1024), principal) }, 201));
}
