import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupEnv } from './helpers';

// API連携（かんたん接続）: キーの暗号化保存・マスク表示・接続テストの結果の区別・モデルの選択・研究での利用・
// 暗号化鍵の変更の検知・デフォルトのモデル・研究からの利用。外部の API には接続せず、HTTP 送信の関数を置き換えて応答を再現する。

type Scenario = 'ok' | 'auth' | 'model' | 'quota' | 'rate' | 'outage' | 'network';
const state: { scenario: Scenario; requests: { url: string; headers: Record<string, string>; body?: string }[] } = { scenario: 'ok', requests: [] };

vi.mock('@/lib/server/http/safeHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/http/safeHttp')>()),
  safeRequest: async (input: { method: string; url: string; headers?: Record<string, string>; body?: string }) => {
    state.requests.push({ url: input.url, headers: input.headers ?? {}, body: input.body });
    const s = state.scenario;
    const json = (status: number, body: unknown) => ({ status, headers: {}, body: JSON.stringify(body) });
    if (s === 'network') {
      const { HttpNetworkError } = await vi.importActual<typeof import('@/lib/server/http/safeHttp')>('@/lib/server/http/safeHttp');
      throw new HttpNetworkError('ECONNREFUSED');
    }
    const auth = input.headers?.authorization ?? input.headers?.['x-api-key'] ?? input.headers?.['x-goog-api-key'] ?? '';
    if (!auth.includes('good')) return json(401, { error: { message: 'Incorrect API key provided' } });
    if (input.url.endsWith('/models')) return json(200, { data: [{ id: 'gpt-test-large' }, { id: 'gpt-test-mini' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }] });
    if (s === 'model') return json(404, { error: { message: 'The model does not exist' } });
    if (s === 'quota') return json(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota' } });
    if (s === 'rate') return json(429, { error: { message: 'Rate limit reached' } });
    if (s === 'outage') return json(503, { error: { message: 'Service unavailable' } });
    return json(200, { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
  },
}));

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'session' as const };

beforeAll(async () => {
  await setupEnv();
});
afterAll(async () => {
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

describe('かんたん接続', () => {
  it('キーを暗号化して保存し、モデルを選んで接続テストし、成功した場合だけ接続済みにする', async () => {
    const { quickConnect, researchModels } = await import('@/lib/server/research/quickConnect');
    const { getConfig } = await import('@/lib/server/storage/store');
    // 無効なキー: 保存はするが接続済みにはしない
    state.scenario = 'ok';
    const bad = await quickConnect({ guide: 'openai', apiKey: 'sk-bad-key-1234567890' });
    expect(bad.result.ok).toBe(false);
    expect(bad.result.errorCategory).toBe('auth');
    expect(bad.provider.connection.status).toBe('failed');
    expect(bad.provider.hasApiKey).toBe(true);
    // 正しいキー: 同じ接続先を再利用し、軽量なモデルを選んで接続済みにする
    const good = await quickConnect({ guide: 'openai', apiKey: 'sk-good-key-1234567890' });
    expect(good.provider.id).toBe(bad.provider.id);
    expect(good.result.ok).toBe(true);
    expect(good.provider.connection.status).toBe('connected');
    expect(good.provider.defaultModel).toBe('gpt-test-mini');
    expect(good.provider.researchEnabled).toBe(true);
    // キーは全文を返さず、保存も暗号文のみ
    const dto = JSON.stringify(good.provider);
    expect(dto).not.toContain('sk-good-key-1234567890');
    expect(good.provider.apiKeyMasked).toBe('sk-••••••••7890');
    const stored = JSON.stringify(await getConfig());
    expect(stored).not.toContain('sk-good-key-1234567890');
    // 最初に接続できたモデルが全体のデフォルトになる
    expect((await getConfig()).defaultModel).toEqual({ providerId: good.provider.id, model: 'gpt-test-mini' });
    // 研究で使えるモデル（埋め込み・音声のモデルも一覧には含まれるが、画面の候補では除外する）
    const models = await researchModels();
    expect(models).toHaveLength(1);
    expect(models[0].models).toContain('gpt-test-mini');
    // 接続テストのリクエストは最小限（キーが無効なら推論は送らない。出力 64 トークン、再試行なし）
    const chat = state.requests.filter((r) => r.url.endsWith('/chat/completions'));
    expect(chat.length).toBe(1);
    expect(JSON.parse(chat[chat.length - 1].body!).max_completion_tokens ?? JSON.parse(chat[chat.length - 1].body!).max_tokens).toBe(64);
  });

  it('接続テストの結果を区別する（キー無効・モデル・利用上限・レート制限・障害・通信）', async () => {
    const { runConnectionTest } = await import('@/lib/server/research/connectionTest');
    const { listProviders } = await import('@/lib/server/research/providers');
    const id = (await listProviders())[0].id;
    const expected: [Scenario, string][] = [
      ['model', 'model_unavailable'],
      ['quota', 'quota'],
      ['rate', 'rate_limit'],
      ['outage', 'server_error'],
      ['network', 'network'],
    ];
    for (const [scenario, category] of expected) {
      state.scenario = scenario;
      const before = state.requests.length;
      const r = await runConnectionTest(id);
      expect(r.ok).toBe(false);
      expect(r.errorCategory).toBe(category);
      // 再試行し続けない（モデル一覧1回＋推論1回まで）
      expect(state.requests.length - before).toBeLessThanOrEqual(2);
    }
    state.scenario = 'ok';
    expect((await runConnectionTest(id)).ok).toBe(true);
  });

  it('研究での利用の無効化・失敗した接続先・未設定では研究を開始できない。指定したモデルを凍結設定に記録し、キーは記録しない', async () => {
    const { listProviders, updateProvider } = await import('@/lib/server/research/providers');
    const { createStudy, startStudy } = await import('@/lib/server/research/study/studies');
    const { setDefaultModel } = await import('@/lib/server/research/quickConnect');
    const p = (await listProviders())[0];
    const design = (agent: Record<string, unknown>) => ({ title: 't', conditions: [{ id: 'A', label: 'A' }], replicates: 1, market: { steps: 1 }, agent });
    // 研究で指定したモデルを使う
    const s1 = await createStudy(design({ kind: 'model', providerId: p.id, model: 'gpt-test-large' }), actor);
    const started = await startStudy(s1.id, actor);
    expect(started.frozen!.agentRole).toMatchObject({ providerId: p.id, providerType: 'openai', model: 'gpt-test-large' });
    expect(JSON.stringify(started.frozen)).not.toMatch(/sk-good|encrypted/);
    // 研究での利用を無効にすると開始できない
    await updateProvider(p.id, { researchEnabled: false });
    const s2 = await createStudy(design({ kind: 'model', providerId: p.id, model: 'gpt-test-mini' }), actor);
    await expect(startStudy(s2.id, actor)).rejects.toThrow(/研究での利用が無効/);
    await expect(setDefaultModel({ providerId: p.id, model: 'gpt-test-mini' })).rejects.toThrow(/無効/);
    await updateProvider(p.id, { researchEnabled: true });
    // 部分的な指定は受け付けない
    await expect(createStudy(design({ kind: 'model', providerId: p.id }), actor)).rejects.toThrow(/両方/);
    // デフォルトのモデルを外し、割り当てもなければ開始できない
    await setDefaultModel({ providerId: null });
    const s3 = await createStudy(design({ kind: 'model' }), actor);
    await expect(startStudy(s3.id, actor)).rejects.toThrow(/モデルが設定されていません/);
    // デフォルトのモデルがあれば、割り当てのない用途はそれを使う
    await setDefaultModel({ providerId: p.id, model: 'gpt-test-mini' });
    expect((await startStudy(s3.id, actor)).frozen!.agentRole!.model).toBe('gpt-test-mini');
    // 接続テストに失敗している接続先では開始できない
    state.scenario = 'rate';
    const { runConnectionTest } = await import('@/lib/server/research/connectionTest');
    await runConnectionTest(p.id);
    const s4 = await createStudy(design({ kind: 'model', providerId: p.id, model: 'gpt-test-mini' }), actor);
    await expect(startStudy(s4.id, actor)).rejects.toThrow(/接続テストに失敗/);
    state.scenario = 'ok';
    await runConnectionTest(p.id);
  });

  it('キーの変更・削除、暗号化鍵の変更を検知する', async () => {
    const { listProviders, setApiKey, deleteApiKey } = await import('@/lib/server/research/providers');
    const p = (await listProviders())[0];
    const updated = await setApiKey(p.id, 'sk-good-another-key-0000');
    expect(updated.apiKeyMasked).toBe('sk-••••••••0000');
    expect(updated.connection.status).toBe('untested');
    const original = process.env.API_KEY_ENCRYPTION_KEY;
    process.env.API_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const mismatch = (await listProviders())[0];
    expect(mismatch.apiKeyReadable).toBe(false);
    expect(mismatch.connection.status).toBe('failed');
    expect(mismatch.connection.message).toMatch(/暗号化鍵/);
    process.env.API_KEY_ENCRYPTION_KEY = original;
    expect((await listProviders())[0].apiKeyReadable).toBe(true);
    const removed = await deleteApiKey(p.id);
    expect(removed.hasApiKey).toBe(false);
    expect(removed.apiKeyMasked).toBeNull();
    expect(removed.connection.status).toBe('unconfigured');
  });

  it('モデルの候補の選び方（ID を固定せず、一覧から文章生成のモデルを選ぶ）', async () => {
    const { suggestModel, chatModels, guideOf, guideForProvider } = await import('@/lib/research/provider-guides');
    const m = (ids: string[]) => ids.map((id) => ({ id, displayName: null, maxOutputTokens: null, supportsReasoning: null }));
    expect(suggestModel(guideOf('anthropic'), m(['claude-opus-x', 'claude-haiku-y', 'other']))).toBe('claude-haiku-y');
    expect(suggestModel(guideOf('openai'), m(['gpt-test-large', 'gpt-test-mini']))).toBe('gpt-test-mini');
    expect(suggestModel(guideOf('gemini'), m(['gemini-pro-z', 'gemini-flash-w', 'text-embedding-004', 'imagen-3']))).toBe('gemini-flash-w');
    expect(chatModels(guideOf('openai'), m(['gpt-a', 'tts-1', 'dall-e-3', 'o4-mini'])).map((x) => x.id)).toEqual(['gpt-a', 'o4-mini']);
    expect(suggestModel(guideOf('openai'), m(['tts-1']))).toBeNull();
    expect(guideForProvider({ type: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1/' })?.id).toBe('openrouter');
    expect(guideForProvider({ type: 'openai_compatible', baseUrl: 'https://example.com/v1' })).toBeNull();
  });
});
