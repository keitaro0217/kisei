import { apiError, json, withAuth } from '@/lib/server/api';
import { issueLineage } from '@/lib/server/research/lineage';

/** 問題（Failure のクラスター）の発見から改善の検証までの全履歴 */
export async function GET(request: Request, ctx: { params: Promise<{ fingerprint: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { fingerprint } = await ctx.params;
    if (!/^[0-9a-f]{16}$/.test(fingerprint)) return apiError(400, 'validation_error', 'クラスターの ID が正しくありません。');
    const lineage = await issueLineage(fingerprint);
    if (!lineage) return apiError(404, 'not_found', 'クラスターが見つかりません。');
    return json({ lineage });
  });
}
