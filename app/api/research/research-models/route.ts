import { json, withAuth } from '@/lib/server/api';
import { researchModels } from '@/lib/server/research/quickConnect';
import { getConfig } from '@/lib/server/storage/store';

/** 研究で使えるモデル（研究での利用が有効で、接続テストに成功した接続先）。APIキーは含めない */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => {
    const state = await getConfig();
    return json({ providers: await researchModels(), defaultModel: state.defaultModel, tradingAgent: { providerId: state.roles.trading_agent.providerId, model: state.roles.trading_agent.model } });
  });
}
