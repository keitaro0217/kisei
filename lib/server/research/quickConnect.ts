import { guideForProvider, guideOf, suggestModel } from '@/lib/research/provider-guides';
import type { ConnectionTestResult, ProviderDTO } from '@/lib/research/types';
import { getConfig, updateConfig } from '../storage/store';
import { runConnectionTest } from './connectionTest';
import { createProvider, fetchModels, getProviderRecord, setApiKey, toDTO, updateProvider, ValidationError } from './providers';

// かんたん接続: サービスを選び、APIキーを貼り付けるだけで使える状態にする。
// 1. 接続先を作成（同じサービスの接続先があれば再利用） 2. キーを暗号化して保存
// 3. モデルの一覧を取得し、モデルを選ぶ（指定がなければ軽量なモデルを候補にする）
// 4. 接続テスト（最小限の推論を1回）。成功した場合だけ「接続済み」になる（キーの保存だけでは接続済みにしない）。

export async function quickConnect(input: Record<string, unknown>): Promise<{ provider: ProviderDTO; result: ConnectionTestResult }> {
  const guide = guideOf(String(input.guide ?? ''));
  if (!guide) throw new ValidationError('接続する AI サービスを選んでください。', 'guide');
  const state = await getConfig();
  let record = state.providers.find((p) => guideForProvider(p)?.id === guide.id) ?? null;
  if (!record) {
    const created = await createProvider({ type: guide.type, name: guide.label, baseUrl: guide.baseUrl, timeoutMs: 60_000, maxRetries: 2 });
    record = (await getProviderRecord(created.id))!;
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    await setApiKey(record.id, input.apiKey);
  } else if (!record.encryptedApiKey) {
    throw new ValidationError('APIキーを貼り付けてください。', 'apiKey');
  }
  // モデルの一覧（失敗しても接続テストで原因を判定する）
  let models = record.models;
  try {
    models = await fetchModels(record.id);
  } catch {
    // 認証エラーなどは接続テストの結果で表示する
  }
  const requested = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : null;
  const current = (await getProviderRecord(record.id))!;
  const model = requested ?? current.defaultModel ?? suggestModel(guide, models);
  if (model && model !== current.defaultModel) await updateProvider(record.id, { defaultModel: model });
  const result = await runConnectionTest(record.id, model);
  // 初めて接続できたサービスは、kisei 全体のデフォルトのモデルにする（すでに設定がある場合は変えない）
  if (result.ok && model) {
    await updateConfig((s) => {
      if (!s.defaultModel) s.defaultModel = { providerId: record!.id, model };
    });
  }
  return { provider: toDTO((await getProviderRecord(record.id))!), result };
}

/** kisei 全体のデフォルトのモデル（用途ごとの割り当てがない場合に使う） */
export async function setDefaultModel(input: Record<string, unknown>) {
  if (input.providerId === null || input.providerId === '') {
    await updateConfig((s) => {
      s.defaultModel = null;
    });
    return null;
  }
  const providerId = String(input.providerId ?? '');
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 200 || !/^[\w.:/@+-]+$/.test(model)) throw new ValidationError('モデルを選んでください。', 'model');
  return updateConfig((s) => {
    const p = s.providers.find((x) => x.id === providerId);
    if (!p) throw new ValidationError('接続先が見つかりません。', 'providerId');
    if (p.researchEnabled === false) throw new ValidationError('研究での利用が無効な接続先はデフォルトにできません。', 'providerId');
    s.defaultModel = { providerId, model };
    return s.defaultModel;
  });
}

/** 研究で使えるモデルの一覧（研究での利用が有効で、接続テストに成功している接続先） */
export async function researchModels() {
  const state = await getConfig();
  return state.providers
    .filter((p) => p.researchEnabled !== false && p.encryptedApiKey !== null && p.connection.status === 'connected')
    .map((p) => {
      const dto = toDTO(p);
      return {
        providerId: p.id,
        providerName: p.name,
        providerType: p.type,
        defaultModel: p.defaultModel,
        models: [...new Set([p.defaultModel, ...p.models.map((m) => m.id)].filter((m): m is string => Boolean(m)))],
        connected: dto.connection.status === 'connected',
      };
    })
    .filter((p) => p.connected);
}
