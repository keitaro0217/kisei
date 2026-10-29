import { apiError, json, withAuth } from '@/lib/server/api';
import { computeClusters } from '@/lib/server/research/failure/failures';
import { listFailures, listHypotheses, listTestCases } from '@/lib/server/storage/failureStore';

/** クラスターの詳細（Failure・テストケース・原因仮説） */
export async function GET(request: Request, ctx: { params: Promise<{ fingerprint: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { fingerprint } = await ctx.params;
    if (!/^[0-9a-f]{16}$/.test(fingerprint)) return apiError(400, 'validation_error', 'クラスターの ID が正しくありません。');
    const [failures, testCases, hypotheses] = await Promise.all([listFailures({ fingerprint }), listTestCases({ fingerprint }), listHypotheses(fingerprint)]);
    if (failures.length === 0) return apiError(404, 'not_found', 'クラスターが見つかりません。');
    return json({ cluster: computeClusters(failures, testCases, hypotheses)[0], failures: failures.slice(0, 500), testCases, hypotheses });
  });
}
