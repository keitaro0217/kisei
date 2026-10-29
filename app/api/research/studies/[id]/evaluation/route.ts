import { apiError, json, withAuth } from '@/lib/server/api';
import { getEvaluation } from '@/lib/server/research/eval/evaluation';
import { scheduleWork } from '@/lib/server/research/scheduler';

export const maxDuration = 300;

/** 多層評価の集計（形式・趣旨・経済/業務・証拠の質・評価器の信頼性）と、評価の実行の一覧 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const data = await getEvaluation(id);
    if (!data) return apiError(404, 'not_found', '研究が見つかりません。');
    if (data.runs.some((r) => r.status === 'running')) scheduleWork(request);
    return json(data);
  });
}
