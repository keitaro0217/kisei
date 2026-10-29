import { json, withAuth } from '@/lib/server/api';
import { monitoringOverview } from '@/lib/server/research/monitor/monitor';

/** 監視（試験版）の概要: 接続元・集計・警告（ログイン中のテナントのものだけ） */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async (principal) => json(await monitoringOverview(principal.tenantId)));
}
