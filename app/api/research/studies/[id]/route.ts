import { apiError, json, readJson, withAuth } from '@/lib/server/api';
import { scheduleWork } from '@/lib/server/research/scheduler';
import { conditionLogistic } from '@/lib/server/research/study/regression';
import { computeStudyStats } from '@/lib/server/research/study/stats';
import { studyLiveness } from '@/lib/server/research/study/operations';
import { computeDomainStats } from '@/lib/server/domain/stats';
import { listDomainSteps } from '@/lib/server/storage/studyStore';
import { getStudyDetail, listDecisions, updateStudyDesign } from '@/lib/server/research/study/studies';

export const maxDuration = 300;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const detail = await getStudyDetail(id);
    if (!detail) return apiError(404, 'not_found', '研究が見つかりません。');
    // 画面を開いている間は処理が進むようにする（担当中のワーカーがいれば重複しない）
    if (detail.study.status === 'running') scheduleWork(request);
    const liveness = await studyLiveness(id);
    if (!detail.study.frozen) return json({ ...detail, liveness, stats: null, regression: null });
    // 金融以外のドメイン: ドメインの集計を返す（判断の記録・回帰分析は金融市場のみ）
    if ((detail.study.frozen.design.domain ?? 'financial_market') !== 'financial_market') {
      return json({ ...detail, liveness, stats: null, regression: null, domainStats: computeDomainStats(detail.study, detail.sessions, await listDomainSteps(id)) });
    }
    const decisions = await listDecisions(id);
    const completed = new Set(detail.sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
    return json({ ...detail, liveness, stats: computeStudyStats(detail.study, detail.sessions, decisions), regression: conditionLogistic(detail.study, decisions, completed) });
  });
}

/** 下書きの研究デザインを更新する（開始後は凍結されており変更できない） */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { id } = await ctx.params;
    return json({ study: await updateStudyDesign(id, await readJson(request, 128 * 1024), principal) });
  });
}
