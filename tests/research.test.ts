import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, startMockLlm, type MockLlm } from './helpers';

let mock: MockLlm;
const KEY = 'sk-test-valid-key-1234';
const actor = { id: 'basic:researcher', displayName: 'researcher', tenantId: 'default', permissions: [], authMethod: 'basic' as const };

beforeAll(async () => {
  setupEnv();
  mock = await startMockLlm();
  process.env.LLM_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${mock.port}`;
});
afterAll(async () => mock.close());

function allDataFiles(): string {
  const dir = process.env.RESEARCH_DATA_DIR!;
  const read = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? read(path.join(d, e.name)) : [readFileSync(path.join(d, e.name), 'utf8')]));
  return read(dir).join('\n');
}

describe('API連携と実験', () => {
  let providerId = '';

  it('プロバイダーを登録し、APIキーは暗号化してマスク表示のみ返す', async () => {
    const { createProvider, setApiKey, listProviders } = await import('@/lib/server/research/providers');
    const p = await createProvider({ type: 'openai_compatible', name: 'Mock', baseUrl: mock.url, defaultModel: 'mock-model' });
    providerId = p.id;
    expect(p.connection.status).toBe('unconfigured');
    const updated = await setApiKey(p.id, KEY);
    expect(updated.hasApiKey).toBe(true);
    expect(updated.apiKeyMasked).toBe('sk-••••••••1234');
    expect(JSON.stringify(await listProviders())).not.toContain(KEY);
    expect(allDataFiles()).not.toContain(KEY);
  });

  it('許可されていないプライベートアドレスは登録時に拒否する', async () => {
    const { createProvider } = await import('@/lib/server/research/providers');
    await expect(createProvider({ type: 'openai_compatible', name: 'Bad', baseUrl: 'http://10.0.0.1/v1' })).rejects.toThrow(/https|プライベート/);
  });

  it('接続テスト: 誤ったキーは認証エラーとして区別し、成功時のみ接続済みにする', async () => {
    const { createProvider, setApiKey } = await import('@/lib/server/research/providers');
    const { runConnectionTest } = await import('@/lib/server/research/connectionTest');
    const bad = await createProvider({ type: 'openai_compatible', name: 'BadKey', baseUrl: mock.url, defaultModel: 'mock-model' });
    await setApiKey(bad.id, 'sk-wrong-key-999999');
    const failed = await runConnectionTest(bad.id);
    expect(failed.ok).toBe(false);
    expect(failed.errorCategory).toBe('auth');
    expect(JSON.stringify(failed)).not.toContain('sk-wrong-key-999999');

    const missingModel = await runConnectionTest(providerId, 'no-such-model');
    expect(missingModel.ok).toBe(false);
    expect(missingModel.errorCategory).toBe('model_unavailable');

    const ok = await runConnectionTest(providerId);
    expect(ok.ok).toBe(true);
    expect(ok.steps.every((s) => s.status === 'ok')).toBe(true);
    const { listProviders } = await import('@/lib/server/research/providers');
    const p = (await listProviders()).find((x) => x.id === providerId)!;
    expect(p.connection.status).toBe('connected');
    expect(p.models.map((m) => m.id)).toContain('mock-model');
    // キーはヘッダーでのみ送信される
    expect(mock.requests.at(-1)!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('実験はスナップショットを固定し、実行中のモデル変更の影響を受けない', async () => {
    const { updateRole } = await import('@/lib/server/research/settings');
    const { upsertPrice } = await import('@/lib/server/research/settings');
    const { createExperiment, waitForJob, getExperiment } = await import('@/lib/server/research/experiments');
    await updateRole('trading_agent', { providerId, model: 'mock-model', maxOutputTokens: 256 });
    await updateRole('llm_judge', { providerId, model: 'mock-judge', maxOutputTokens: 256 });
    await upsertPrice({ providerId, model: 'mock-model', inputPerMTok: 1, outputPerMTok: 2, source: 'テスト用単価' });

    const exp = await createExperiment({ name: 'E1', episodes: 6, steps: 3, seed: 1, judgeEnabled: true }, actor);
    expect(exp.snapshot.roles.trading_agent.model).toBe('mock-model');
    // 実験開始後に割り当てを変更しても、実行中の実験には反映されない
    await updateRole('trading_agent', { model: 'mock-judge' });
    await waitForJob(exp.id);

    const data = (await getExperiment(exp.id))!;
    expect(data.experiment.status).toBe('completed');
    expect(data.experiment.completedEpisodes).toBe(6);
    expect(data.episodes).toHaveLength(6);
    expect(data.episodes.every((e) => e.judge?.score === 4)).toBe(true);
    // 6エピソード × (3ステップ + Judge 1回)
    expect(data.experiment.usage.calls).toBe(24);
    expect(data.experiment.usage.reasoningTokens).toBe(24 * 5);
    // 単価未設定の Judge モデルの呼び出しは費用を推測しない
    expect(data.experiment.usage.unpricedCalls).toBe(6);
    // 取引 18 回 × (非キャッシュ入力 60 × $1 + キャッシュ 40 × $1 + 出力 20 × $2) / 100万
    expect(data.experiment.usage.costUsd).toBeCloseTo((18 * 140) / 1e6, 8);
    const tradeModels = mock.requests.filter((r) => r.url.endsWith('/chat/completions')).map((r) => JSON.parse(r.body).model);
    expect(tradeModels.filter((m) => m === 'mock-model').length).toBeGreaterThanOrEqual(18);

    // 設定が異なる実験は別バージョンになる
    const exp2 = await createExperiment({ name: 'E2', episodes: 1, steps: 1, seed: 1 }, actor);
    expect(exp2.versionHash).not.toBe(exp.versionHash);
    await waitForJob(exp2.id);
  });

  it('予算上限に達すると実験を一時停止し、研究条件を保持したまま再開できる', async () => {
    const { updateProvider } = await import('@/lib/server/research/providers');
    const { updateRole, upsertPrice } = await import('@/lib/server/research/settings');
    const { createExperiment, waitForJob, getExperiment, resumeExperiment } = await import('@/lib/server/research/experiments');
    await updateRole('trading_agent', { model: 'mock-model' });
    await upsertPrice({ providerId, model: 'mock-model', inputPerMTok: 1000, outputPerMTok: 1000, source: 'テスト用の高額単価' });
    const { monthlyTotals } = await import('@/lib/server/research/usage');
    const spent = (await monthlyTotals()).byProvider[providerId].costUsd;
    // 次の呼び出し1回で上限を超える予算
    await updateProvider(providerId, { monthlyBudgetUsd: Math.ceil((spent + 0.05) * 100) / 100 });
    const exp = await createExperiment({ name: 'Budget', episodes: 20, steps: 2, seed: 5 }, actor);
    await waitForJob(exp.id);
    let data = (await getExperiment(exp.id))!;
    expect(data.experiment.status).toBe('paused');
    expect(data.experiment.statusCategory).toBe('budget_exceeded');
    expect(data.experiment.completedEpisodes).toBeLessThan(20);
    const snapshotBefore = JSON.stringify(data.experiment.snapshot);

    await expect(resumeExperiment(exp.id, actor)).rejects.toThrow(/予算/);
    await updateProvider(providerId, { monthlyBudgetUsd: null });
    await resumeExperiment(exp.id, actor);
    await waitForJob(exp.id);
    data = (await getExperiment(exp.id))!;
    expect(data.experiment.status).toBe('completed');
    expect(data.experiment.completedEpisodes).toBe(20);
    expect(new Set(data.episodes.map((e) => e.index)).size).toBe(20);
    expect(JSON.stringify(data.experiment.snapshot)).toBe(snapshotBefore);
  });

  it('接続先が変更された実験は再開を拒否する', async () => {
    const { updateProvider } = await import('@/lib/server/research/providers');
    const { createExperiment, waitForJob, getExperiment, resumeExperiment, pauseExperiment } = await import('@/lib/server/research/experiments');
    const exp = await createExperiment({ name: 'Change', episodes: 50, steps: 1, seed: 9 }, actor);
    await pauseExperiment(exp.id, actor);
    await waitForJob(exp.id);
    expect((await getExperiment(exp.id))!.experiment.status).toBe('paused');
    await updateProvider(providerId, { baseUrl: mock.url.replace('/v1', '/v2') });
    await expect(resumeExperiment(exp.id, actor)).rejects.toThrow(/変更/);
    await updateProvider(providerId, { baseUrl: mock.url });
  });

  it('APIキーがデータファイル・使用履歴・監査ログに含まれない', async () => {
    expect(allDataFiles()).not.toContain(KEY);
    expect(allDataFiles()).not.toContain('sk-wrong-key-999999');
  });
});
