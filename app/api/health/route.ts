import { healthCheck } from '@/lib/server/ops';

// 公開のヘルスチェック（外部の死活監視用）。認証なしで使えるため、構成の詳細・バージョン・エラーの内容は返さない。
export const dynamic = 'force-dynamic';

export async function GET() {
  const h = await healthCheck();
  return Response.json({ status: h.ok ? 'ok' : 'degraded', database: h.database }, { status: h.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
