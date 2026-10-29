import { json, withAuth } from '@/lib/server/api';
import type { TestCaseStatus, TestDataset } from '@/lib/research/failure-types';
import { listTestCases } from '@/lib/server/storage/failureStore';

const DATASETS: TestDataset[] = ['known_failure', 'normal_behavior', 'boundary', 'previously_fixed'];
const STATUSES: TestCaseStatus[] = ['candidate', 'approved', 'rejected'];

/** 回帰テストのデータセット */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const q = new URL(request.url).searchParams;
    const dataset = q.get('dataset') as TestDataset | null;
    const status = q.get('status') as TestCaseStatus | null;
    return json({ testCases: await listTestCases({ dataset: dataset && DATASETS.includes(dataset) ? dataset : undefined, status: status && STATUSES.includes(status) ? status : undefined }) });
  });
}
