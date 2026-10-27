import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, startMockLlm, type MockLlm } from './helpers';

let mock: MockLlm;
beforeAll(async () => {
  setupEnv();
  mock = await startMockLlm();
  process.env.LLM_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${mock.port}`;
});
afterAll(async () => mock.close());

const base = () => `http://127.0.0.1:${mock.port}`;
const input = { model: 'm1', system: 'sys', user: 'hi', maxOutputTokens: 50, reasoning: { effort: 'low' as const } };

describe('プロバイダーアダプター', () => {
  it('Anthropic: ヘッダー・effort・キャッシュトークンを正しく扱う', async () => {
    const { anthropicAdapter } = await import('@/lib/server/llm/adapters/anthropic');
    mock.setHandler((req) =>
      req.url.startsWith('/v1/models')
        ? { status: 200, body: { data: [{ id: 'm1', display_name: 'M1', max_tokens: 64000 }], has_more: false } }
        : {
            status: 200,
            body: {
              content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'OK' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 30, cache_creation_input_tokens: 2 },
            },
          },
    );
    const rt = { type: 'anthropic' as const, baseUrl: base(), apiKey: 'sk-ant-xyz12345', timeoutMs: 5000 };
    expect((await anthropicAdapter.listModels(rt))[0]).toMatchObject({ id: 'm1', maxOutputTokens: 64000 });
    const out = await anthropicAdapter.chat(rt, input);
    const req = mock.requests.at(-1)!;
    expect(req.headers['x-api-key']).toBe('sk-ant-xyz12345');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(req.body)).toMatchObject({ max_tokens: 50, output_config: { effort: 'low' }, system: 'sys' });
    expect(out.text).toBe('OK');
    expect(out.usage).toEqual({ inputTokens: 42, outputTokens: 5, cachedTokens: 30, cacheWriteTokens: 2, reasoningTokens: null });
  });

  it('Anthropic: refusal と認証エラーを区別する', async () => {
    const { anthropicAdapter } = await import('@/lib/server/llm/adapters/anthropic');
    const rt = { type: 'anthropic' as const, baseUrl: base(), apiKey: 'sk-ant-xyz12345', timeoutMs: 5000 };
    mock.setHandler(() => ({ status: 200, body: { content: [], stop_reason: 'refusal', usage: {} } }));
    await expect(anthropicAdapter.chat(rt, input)).rejects.toMatchObject({ category: 'refusal' });
    mock.setHandler(() => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
    await expect(anthropicAdapter.chat(rt, input)).rejects.toMatchObject({ category: 'auth' });
    mock.setHandler(() => ({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } }));
    await expect(anthropicAdapter.chat(rt, input)).rejects.toMatchObject({ category: 'rate_limit' });
    mock.setHandler(() => ({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } } }));
    await expect(anthropicAdapter.chat(rt, input)).rejects.toMatchObject({ category: 'server_error' });
  });

  it('Gemini: 思考トークンを推論トークンとして記録し、思考パートを本文から除く', async () => {
    const { geminiAdapter } = await import('@/lib/server/llm/adapters/gemini');
    mock.setHandler((req) =>
      req.url.includes('/models?')
        ? { status: 200, body: { models: [{ name: 'models/g1', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192, thinking: true }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] } }
        : {
            status: 200,
            body: {
              candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: 'ANSWER' }] }, finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 7, cachedContentTokenCount: 4 },
            },
          },
    );
    const rt = { type: 'gemini' as const, baseUrl: `${base()}/v1beta`, apiKey: 'AIzaTESTKEY', timeoutMs: 5000 };
    const models = await geminiAdapter.listModels(rt);
    expect(models).toEqual([{ id: 'g1', displayName: null, maxOutputTokens: 8192, supportsReasoning: true }]);
    const out = await geminiAdapter.chat(rt, { ...input, model: 'g1', reasoning: { thinkingBudget: 256 } });
    const req = mock.requests.at(-1)!;
    expect(req.url).toBe('/v1beta/models/g1:generateContent');
    expect(req.headers['x-goog-api-key']).toBe('AIzaTESTKEY');
    expect(req.url).not.toContain('key=');
    expect(JSON.parse(req.body).generationConfig).toEqual({ maxOutputTokens: 50, thinkingConfig: { thinkingBudget: 256 } });
    expect(out.text).toBe('ANSWER');
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 10, cachedTokens: 4, cacheWriteTokens: 0, reasoningTokens: 7 });
  });

  it('Ollama: モデル一覧とトークン数を取得する', async () => {
    const { ollamaAdapter } = await import('@/lib/server/llm/adapters/ollama');
    mock.setHandler((req) =>
      req.url === '/api/tags'
        ? { status: 200, body: { models: [{ name: 'llama3.2:latest' }] } }
        : { status: 200, body: { message: { content: 'hi' }, done_reason: 'stop', prompt_eval_count: 9, eval_count: 4 } },
    );
    const rt = { type: 'ollama' as const, baseUrl: base(), apiKey: null, timeoutMs: 5000 };
    expect((await ollamaAdapter.listModels(rt))[0].id).toBe('llama3.2:latest');
    const out = await ollamaAdapter.chat(rt, { ...input, model: 'llama3.2:latest' });
    expect(JSON.parse(mock.requests.at(-1)!.body)).toMatchObject({ stream: false, options: { num_predict: 50 } });
    expect(out.usage.inputTokens).toBe(9);
    expect(mock.requests.at(-1)!.headers.authorization).toBeUndefined();
  });

  it('OpenAI: max_completion_tokens と reasoning_effort を送り、リダイレクトは追跡しない', async () => {
    const { createOpenAiAdapter } = await import('@/lib/server/llm/adapters/openai');
    const adapter = createOpenAiAdapter(false);
    mock.setHandler(() => ({ status: 200, body: { choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }));
    const rt = { type: 'openai' as const, baseUrl: `${base()}/v1`, apiKey: 'sk-abcdefgh1234', timeoutMs: 5000 };
    await adapter.chat(rt, input);
    expect(JSON.parse(mock.requests.at(-1)!.body)).toMatchObject({ max_completion_tokens: 50, reasoning_effort: 'low' });
    mock.setHandler(() => ({ status: 302, body: {} }));
    await expect(adapter.chat(rt, input)).rejects.toMatchObject({ category: 'ssrf_blocked' });
  });

  it('タイムアウトを通信障害と区別する', async () => {
    const { safeRequest } = await import('@/lib/server/http/safeHttp');
    const { toLlmError } = await import('@/lib/server/llm/errors');
    const http = await import('node:http');
    const server = http.createServer(() => {});
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    process.env.LLM_ALLOWED_PRIVATE_HOSTS += `,127.0.0.1:${port}`;
    const err = await safeRequest({ method: 'GET', url: `http://127.0.0.1:${port}/`, timeoutMs: 300 }).catch((e) => e);
    expect(toLlmError(err).category).toBe('timeout');
    server.closeAllConnections();
    server.close();
    const refused = await safeRequest({ method: 'GET', url: `http://127.0.0.1:${port}/`, timeoutMs: 1000 }).catch((e) => e);
    expect(toLlmError(refused).category).toBe('network');
  });
});
