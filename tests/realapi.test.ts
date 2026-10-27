import { describe, expect, it } from 'vitest';

// 実際のプロバイダーAPIへの疎通確認。REAL_API_TEST=1 のときのみ実行する。
// <TYPE>_TEST_KEY（例: ANTHROPIC_TEST_KEY）を設定すると、実際にモデル一覧を取得できることを確認する。
// 未設定の場合は偽のキーで「認証エラー」等に正しく分類されることを確認する。
describe.runIf(process.env.REAL_API_TEST === '1')('実API疎通', () => {
  it.each([
    ['anthropic', 'https://api.anthropic.com'],
    ['openai', 'https://api.openai.com/v1'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta'],
  ] as const)('%s', async (type, baseUrl) => {
    const { getAdapter } = await import('@/lib/server/llm/adapters');
    const realKey = process.env[`${type.toUpperCase()}_TEST_KEY`];
    const result = await getAdapter(type)
      .listModels({ type, baseUrl, apiKey: realKey ?? 'sk-invalid-test-key-000000', timeoutMs: 15000 })
      .then((models) => ({ models, error: null }))
      .catch((error) => ({ models: null, error }));
    console.log(type, result.error ? `${result.error.category}: ${result.error.message}` : `${result.models!.length} models`);
    if (realKey) expect(result.error).toBeNull();
    else expect(['auth', 'permission', 'invalid_request', 'network']).toContain(result.error?.category);
  });
});
