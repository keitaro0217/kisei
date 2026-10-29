import { apiError, json, withAuth } from '@/lib/server/api';
import { evidenceGraph } from '@/lib/server/research/failure/rootCause';
import { getHypothesis } from '@/lib/server/storage/failureStore';
import { getStudy } from '@/lib/server/storage/studyStore';

/** 原因仮説の詳細と証拠グラフ */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const hypothesis = await getHypothesis(id);
    if (!hypothesis) return apiError(404, 'not_found', '仮説が見つかりません。');
    const experiment = hypothesis.experimentStudyId ? await getStudy(hypothesis.experimentStudyId) : null;
    return json({ hypothesis, graph: await evidenceGraph(id), experiment: experiment && { id: experiment.id, status: experiment.status, isMock: experiment.isMock, frozenHash: experiment.frozenHash } });
  });
}
