import { apiError, json, withAuth } from '@/lib/server/api';
import { computeStudyStats } from '@/lib/server/research/study/stats';
import { getStudyDetail, listDecisions } from '@/lib/server/research/study/studies';

/** 複数の研究の結果を並べて比較する（研究どうしは対応のない比較） */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const ids = (new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 4);
    if (ids.length === 0) return apiError(400, 'validation_error', '比較する研究を選んでください。');
    const out = [];
    for (const id of ids) {
      const detail = await getStudyDetail(id);
      if (!detail?.study.frozen) continue;
      const stats = computeStudyStats(detail.study, detail.sessions, await listDecisions(id));
      const f = detail.study.frozen;
      out.push({
        id,
        title: f.design.title,
        status: detail.study.status,
        isMock: detail.study.isMock,
        frozenHash: detail.study.frozenHash,
        model: f.agentRole ? `${f.agentRole.providerName} / ${f.agentRole.model}` : 'モック',
        prompt: `${f.promptSet.name} v${f.promptSet.version}`,
        market: f.design.market,
        replicates: f.design.replicates,
        baseSeed: f.design.baseSeed,
        conditions: stats.conditions.map((c) => ({
          id: c.conditionId,
          label: c.label,
          completed: c.sessions.completed,
          failed: c.sessions.failed,
          attempts: c.orderAttempts,
          ruleViolationRate: c.ruleViolationRate,
          intentDeviationRate: c.intentDeviationRate,
          meanPnl: c.pnl.mean,
          costUsd: c.costUsd,
          meanSessionSeconds: c.sessionSeconds.mean,
        })),
      });
    }
    return json({ studies: out });
  });
}
