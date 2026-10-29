import { apiError, json, withAuth } from '@/lib/server/api';
import { toOtlp } from '@/lib/server/research/trace/tracer';
import { getTrace } from '@/lib/server/storage/traceStore';

/**
 * 1件のトレース。format=otlp で OpenTelemetry（OTLP/JSON）形式、download=1 でファイルとして返す。
 * 本文（プロンプト・応答）は記録時の設定（本文なし／伏せ字／そのまま）に従って保存されたものだけを返す。
 */
export async function GET(request: Request, ctx: { params: Promise<{ traceId: string }> }) {
  return withAuth(request, 'research:read', async () => {
    const { traceId } = await ctx.params;
    if (!/^[0-9a-f]{32}$/.test(traceId)) return apiError(400, 'validation_error', 'トレースIDが正しくありません。');
    const trace = await getTrace(traceId);
    if (!trace) return apiError(404, 'not_found', 'トレースが見つかりません（保存期間を過ぎて削除された可能性があります）。');
    const q = new URL(request.url).searchParams;
    const body = q.get('format') === 'otlp' ? toOtlp(trace) : trace;
    if (q.get('download') !== '1') return json({ trace: body });
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="trace-${traceId.slice(0, 12)}${q.get('format') === 'otlp' ? '-otlp' : ''}.json"`,
        'cache-control': 'no-store',
      },
    });
  });
}
