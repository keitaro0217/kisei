import { apiError, json, withAuth } from '@/lib/server/api';
import { getPatch, listRegressionRuns } from '@/lib/server/storage/patchStore';
import { getStudy } from '@/lib/server/storage/studyStore';

/** 修正案の詳細と回帰テストの履歴 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const patch = await getPatch(id);
    if (!patch) return apiError(404, 'not_found', '修正案が見つかりません。');
    const experiment = patch.experimentStudyId ? await getStudy(patch.experimentStudyId) : null;
    return json({ patch, runs: await listRegressionRuns(id), experiment: experiment && { id: experiment.id, status: experiment.status, isMock: experiment.isMock } });
  });
}
