import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { quickConnect } from '@/lib/server/research/quickConnect';

export const maxDuration = 60;

/**
 * かんたん接続: サービスを選んで APIキーを貼り付けると、暗号化して保存し、モデルを選んで接続テストまで行う。
 * 応答にキー本体は含めない（マスク済みの値のみ）。
 */
export async function POST(request: Request) {
  return withAuth(request, 'credentials:write', async (principal) => {
    const body = await readJson(request, 4096);
    const { provider, result } = await quickConnect(body);
    await audit(principal, 'provider.quick_connect', provider.id, result.ok ? 'success' : 'failure', `${provider.name}: ${result.message}`);
    return json({ provider, result });
  });
}
