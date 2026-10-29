import { apiError, withAuth } from '@/lib/server/api';
import { computePocMetrics, getPoc, pocCsv, pocMarkdown } from '@/lib/server/research/poc/poc';
import { getStudy } from '@/lib/server/storage/studyStore';

/** PoC レポート（Markdown / JSON / CSV）。PDF は印刷用の画面からブラウザの印刷機能で保存する */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { id } = await ctx.params;
    const poc = await getPoc(id);
    if (!poc) return apiError(404, 'not_found', 'PoC が見つかりません。');
    const metrics = await computePocMetrics(poc);
    const format = new URL(request.url).searchParams.get('format') ?? 'md';
    const studies = [];
    for (const sid of poc.studyIds) {
      const s = await getStudy(sid);
      if (s) studies.push({ id: s.id, title: s.design.title, isMock: s.isMock, frozenHash: s.frozenHash });
    }
    const name = `poc-${id.slice(0, 8)}`;
    const send = (body: string, type: string, ext: string) =>
      new Response(body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}.${ext}"`, 'cache-control': 'no-store' } });
    if (format === 'json') return send(JSON.stringify({ schema: 'kisei.poc-report/v1', poc, studies, metrics, generatedAt: new Date().toISOString() }, null, 2), 'application/json; charset=utf-8', 'json');
    if (format === 'csv') return send(pocCsv(metrics), 'text/csv; charset=utf-8', 'csv');
    if (format === 'md') return send(pocMarkdown(poc, metrics, studies), 'text/markdown; charset=utf-8', 'md');
    return apiError(400, 'validation_error', '出力形式が正しくありません。');
  });
}
