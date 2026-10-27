import { json, readJson, withAuth } from '@/lib/server/api';
import { createExperiment, listExperiments } from '@/lib/server/research/experiments';
import { getState } from '@/lib/server/storage/store';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const state = await getState();
    return json({ experiments: await listExperiments(), versions: state.experimentVersions });
  });
}

export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => {
    const experiment = await createExperiment(await readJson(request), principal);
    return json({ experiment }, 201);
  });
}
