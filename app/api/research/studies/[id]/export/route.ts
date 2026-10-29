import { apiError, withAuth } from '@/lib/server/api';
import { decisionsCsv, manifestJson, markdownReport, sessionsCsv, summaryJson } from '@/lib/server/research/study/exports';
import { listEvalRuns } from '@/lib/server/storage/evalStore';
import { conditionLogistic } from '@/lib/server/research/study/regression';
import { computeStudyStats } from '@/lib/server/research/study/stats';
import { getStudyDetail, listDecisions } from '@/lib/server/research/study/studies';
import { canonical } from '@/lib/server/util/canonical';

export const maxDuration = 60;

const FORMATS = {
  'decisions.csv': 'text/csv; charset=utf-8',
  'sessions.csv': 'text/csv; charset=utf-8',
  'summary.json': 'application/json; charset=utf-8',
  'config.json': 'application/json; charset=utf-8',
  'report.md': 'text/markdown; charset=utf-8',
  'manifest.json': 'application/json; charset=utf-8',
} as const;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const format = new URL(request.url).searchParams.get('format') as keyof typeof FORMATS | null;
    if (!format || !(format in FORMATS)) return apiError(400, 'validation_error', '出力形式が正しくありません。');
    const detail = await getStudyDetail(id);
    if (!detail) return apiError(404, 'not_found', '研究が見つかりません。');
    if (!detail.study.frozen) return apiError(409, 'not_started', '開始前の研究には出力できる結果がありません。');
    const { study, sessions } = detail;
    let body: string;
    if (format === 'config.json') {
      // 凍結設定（キー順を正規化した JSON）とハッシュ。frozenHash は凍結設定から運用設定・凍結時刻を除いた内容のハッシュ
      body = JSON.stringify({ frozenHash: study.frozenHash, isMock: study.isMock, frozenConfig: JSON.parse(canonical(study.frozen)) }, null, 2);
    } else if (format === 'manifest.json') {
      const runs = await listEvalRuns(id);
      body = JSON.stringify(
        manifestJson(study, sessions, runs.map((r) => ({ name: r.name, kind: r.kind, promptVersion: r.promptVersion, promptHash: r.promptHash, model: r.judgeRole?.model ?? null }))),
        null,
        2,
      );
    } else if (format === 'sessions.csv') {
      body = sessionsCsv(sessions);
    } else {
      const decisions = await listDecisions(id);
      if (format === 'decisions.csv') {
        body = decisionsCsv(decisions);
      } else {
        const stats = computeStudyStats(study, sessions, decisions);
        const completed = new Set(sessions.filter((s) => s.status === 'completed').map((s) => `${s.conditionId}/${s.replicate}`));
        const regression = conditionLogistic(study, decisions, completed);
        body = format === 'summary.json' ? JSON.stringify({ ...summaryJson(study, sessions, stats), regression }, null, 2) : markdownReport(study, sessions, stats, regression);
      }
    }
    const name = `study-${id.slice(0, 8)}${study.isMock ? '-MOCK' : ''}-${format}`;
    return new Response(body, {
      headers: {
        'content-type': FORMATS[format],
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}
