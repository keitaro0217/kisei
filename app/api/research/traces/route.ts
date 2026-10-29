import { json, withAuth } from '@/lib/server/api';
import { listTraces, type TraceFilter } from '@/lib/server/storage/traceStore';

const bool = (v: string | null) => (v === 'true' ? true : v === 'false' ? false : undefined);

/** トレースの検索（本文は含めない一覧） */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const q = new URL(request.url).searchParams;
    const replicate = q.get('replicate');
    const status = q.get('status');
    const filter: TraceFilter = {
      studyId: q.get('study') || undefined,
      conditionId: q.get('condition') || undefined,
      replicate: replicate !== null && /^\d+$/.test(replicate) ? Number(replicate) : undefined,
      model: q.get('model') || undefined,
      status: status === 'OK' || status === 'ERROR' ? status : undefined,
      hasViolation: bool(q.get('violation')),
      hasDeviation: bool(q.get('deviation')),
      hasBoundary: bool(q.get('boundary')),
      from: q.get('from') && !Number.isNaN(Date.parse(q.get('from')!)) ? q.get('from')! : undefined,
      to: q.get('to') && !Number.isNaN(Date.parse(q.get('to')!)) ? q.get('to')! : undefined,
      limit: Math.min(Math.max(Number(q.get('limit') ?? 50) || 50, 1), 200),
      offset: Math.max(Number(q.get('offset') ?? 0) || 0, 0),
    };
    return json({ traces: await listTraces(filter) });
  });
}
