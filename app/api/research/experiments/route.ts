import { json, readJson, withAuth } from '@/lib/server/api';
import { createExperiment, listExperiments } from '@/lib/server/research/experiments';
import { scheduleWork } from '@/lib/server/research/scheduler';
import { getConfig } from '@/lib/server/storage/store';

export const maxDuration = 300;

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const config = await getConfig();
    return json({ experiments: await listExperiments(), versions: config.experimentVersions });
  });
}

export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => {
    const experiment = await createExperiment(await readJson(request), principal);
    scheduleWork(request);
    return json({ experiment }, 201);
  });
}
