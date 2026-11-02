import { json, readJson, withAuth } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { setDefaultModel } from '@/lib/server/research/quickConnect';

/** kisei 全体のデフォルトのモデル（用途ごとの割り当てがない場合に使う） */
export async function PUT(request: Request) {
  return withAuth(request, 'settings:write', async (principal) => {
    const defaultModel = await setDefaultModel(await readJson(request));
    await audit(principal, 'settings.default_model', defaultModel ? `${defaultModel.providerId}:${defaultModel.model}` : null, 'success');
    return json({ defaultModel });
  });
}
