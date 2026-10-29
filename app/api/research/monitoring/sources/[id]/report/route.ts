import { withAuth } from '@/lib/server/api';
import { monitoringAuditReport } from '@/lib/server/research/monitor/monitor';

/** 監視の監査レポート（Markdown） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'audit:read', async (principal) => {
    const { id } = await ctx.params;
    return new Response(await monitoringAuditReport(principal.tenantId, id), {
      headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="monitoring-audit-${id.slice(0, 8)}.md"`, 'cache-control': 'no-store' },
    });
  });
}
