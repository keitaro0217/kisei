import { json, readJson, withAuth } from '@/lib/server/api';
import { cancelJob, retryJob } from '@/lib/server/jobs/queue';
import { audit } from '@/lib/server/audit';
import { operationsStatus } from '@/lib/server/ops';

export async function GET(request: Request) {
  return withAuth(request, 'audit:read', async () => json(await operationsStatus()));
}

/** ジョブの再実行・取り消し */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => {
    const body = await readJson(request);
    const id = String(body.jobId ?? '');
    const ok = body.action === 'retry' ? await retryJob(id) : body.action === 'cancel' ? await cancelJob(id) : false;
    await audit(principal, `job.${String(body.action)}`, id, ok ? 'success' : 'failure');
    return json({ ok });
  });
}
