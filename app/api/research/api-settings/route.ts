import { json, withAuth } from '@/lib/server/api';
import { getEncryptionKey } from '@/lib/server/env';
import { listProviders } from '@/lib/server/research/providers';
import { getConfig } from '@/lib/server/storage/store';

/** API設定の画面に必要な情報（接続先・デフォルトのモデル・用途ごとの割り当て・暗号化の準備状況）。APIキーは含めない */
export async function GET(request: Request) {
  return withAuth(request, 'settings:read', async () => {
    const state = await getConfig();
    return json({ providers: await listProviders(), defaultModel: state.defaultModel, roles: state.roles, encryptionReady: getEncryptionKey() !== null });
  });
}
