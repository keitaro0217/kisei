import { apiKeyRequired, errorCategoryLabels } from '@/lib/research/labels';
import type { ConnectionTestResult, ConnectionTestStep, ModelInfo } from '@/lib/research/types';
import { getAdapter } from '../llm/adapters';
import { invokeModel } from '../llm/client';
import { LlmError, toLlmError } from '../llm/errors';
import { getConfig, updateConfig } from '../storage/store';
import { getProviderRecord, runtimeFor, ValidationError } from './providers';

const LABELS: Record<ConnectionTestStep['key'], string> = {
  api_key: 'APIキーの登録',
  network: '接続先との安全な通信',
  model: '指定モデルの利用可否',
  inference: '最小限のテストリクエスト',
};

/**
 * 接続テスト。4段階を順に確認し、すべて成功した場合のみ「接続済み」にする。
 * モデル一覧の取得だけでは推論できるか分からないため、最後に最小限の推論を実行する。
 */
export async function runConnectionTest(providerId: string, requestedModel?: string | null): Promise<ConnectionTestResult> {
  const record = await getProviderRecord(providerId);
  if (!record) throw new ValidationError('プロバイダーが見つかりません。');
  const fingerprint = { baseUrl: record.baseUrl, apiKeyUpdatedAt: record.apiKeyUpdatedAt };

  const steps: ConnectionTestStep[] = (Object.keys(LABELS) as ConnectionTestStep['key'][]).map((key) => ({
    key,
    label: LABELS[key],
    status: 'skipped',
    message: null,
  }));
  const step = (key: ConnectionTestStep['key']) => steps.find((s) => s.key === key)!;

  const state = await getConfig();
  const model =
    requestedModel?.trim() ||
    record.defaultModel ||
    Object.values(state.roles).find((r) => r.providerId === providerId && r.model)?.model ||
    null;

  const finish = async (error: LlmError | null, latencyMs: number | null): Promise<ConnectionTestResult> => {
    const ok = error === null;
    const result: ConnectionTestResult = {
      ok,
      model,
      steps,
      errorCategory: error?.category ?? null,
      message: error ? `${errorCategoryLabels[error.category]}: ${error.message}` : '接続テストに成功しました。',
      latencyMs,
    };
    await updateConfig((s) => {
      const r = s.providers.find((p) => p.id === providerId);
      // テスト中にAPIキーや接続先が変更された場合は結果を反映しない
      if (!r || r.baseUrl !== fingerprint.baseUrl || r.apiKeyUpdatedAt !== fingerprint.apiKeyUpdatedAt) return;
      r.connection = {
        status: ok ? 'connected' : error?.category === 'not_configured' ? 'unconfigured' : 'failed',
        testedAt: new Date().toISOString(),
        testedModel: model,
        errorCategory: error?.category ?? null,
        message: result.message,
      };
    });
    return result;
  };

  // 1. APIキー
  let rt;
  try {
    rt = runtimeFor(record);
    step('api_key').status = 'ok';
    step('api_key').message = rt.apiKey ? '登録済み（暗号化して保存）' : 'このプロバイダーではAPIキーは任意です';
  } catch (e) {
    const err = toLlmError(e);
    step('api_key').status = 'failed';
    step('api_key').message = err.message;
    return finish(err, null);
  }
  if (!apiKeyRequired[record.type] && !rt.apiKey) step('api_key').status = 'ok';

  // 2. 通信 + モデル一覧
  let models: ModelInfo[] | null = null;
  try {
    models = await getAdapter(record.type).listModels(rt);
    step('network').status = 'ok';
    step('network').message = `接続できました（モデル ${models.length} 件を取得）`;
    await updateConfig((s) => {
      const r = s.providers.find((p) => p.id === providerId);
      if (r && r.baseUrl === fingerprint.baseUrl) {
        r.models = models!;
        r.modelsFetchedAt = new Date().toISOString();
      }
    });
  } catch (e) {
    const err = toLlmError(e, [rt.apiKey]);
    if (['network', 'timeout', 'ssrf_blocked'].includes(err.category)) {
      step('network').status = 'failed';
      step('network').message = err.message;
      return finish(err, null);
    }
    step('network').status = 'ok';
    step('network').message = '接続先に到達しました';
    if (err.category === 'auth' || err.category === 'permission' || err.category === 'quota') {
      step('model').status = 'failed';
      step('model').message = err.message;
      return finish(err, null);
    }
    // モデル一覧APIに対応していない互換APIもあるため、推論リクエストで確認する
    step('model').message = 'モデル一覧を取得できなかったため、テストリクエストで確認します';
  }

  // 3. モデル
  if (!model) {
    const err = new LlmError('not_configured', 'テストするモデルが選択されていません。モデル一覧から選択してください。');
    step('model').status = 'failed';
    step('model').message = err.message;
    return finish(err, null);
  }
  if (models && models.length > 0) {
    const found = models.some((m) => m.id === model);
    if (found) {
      step('model').status = 'ok';
      step('model').message = `「${model}」が利用可能なモデル一覧に含まれています`;
    } else {
      // エイリアス名など一覧に現れないモデルもあるため、推論リクエストの結果で最終判断する
      step('model').message = `「${model}」はモデル一覧にないため、テストリクエストで確認します`;
    }
  }

  // 4. 最小限の推論
  try {
    const res = await invokeModel({
      providerId,
      model,
      reasoning: {},
      maxOutputTokens: 64,
      system: 'You are a connectivity check. Reply with the single word OK.',
      user: 'Reply with OK.',
      purpose: 'connection_test',
      maxRetries: 0,
    });
    step('inference').status = 'ok';
    step('inference').message = `応答を受信しました（${res.latencyMs} ms / 入力 ${res.usage.inputTokens}・出力 ${res.usage.outputTokens} トークン）`;
    if (step('model').status === 'skipped') {
      step('model').status = 'ok';
      step('model').message = `「${model}」で推論できることを確認しました`;
    }
    return finish(null, res.latencyMs);
  } catch (e) {
    const err = toLlmError(e, [rt.apiKey]);
    if (err.category === 'model_unavailable') {
      step('model').status = 'failed';
      step('model').message = err.message;
    }
    step('inference').status = 'failed';
    step('inference').message = err.message;
    return finish(err, null);
  }
}
