import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * テスト用の環境を用意する。
 * TEST_DATABASE_URL が設定されていれば、その PostgreSQL サーバーにテストファイルごとの新しいデータベースを作って使う。
 * 未設定なら組み込み Postgres（PGlite）を一時ディレクトリに作って使う。
 */
export async function setupEnv() {
  process.env.RESEARCH_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'research-test-'));
  process.env.API_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.BASIC_AUTH_USERNAME = 'researcher';
  process.env.BASIC_AUTH_PASSWORD = 'correct-horse-battery';
  process.env.RESEARCH_WORKER_AUTOSTART = '0';
  delete process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;
  const admin = process.env.TEST_DATABASE_URL;
  if (admin) {
    const { default: postgres } = await import('postgres');
    const name = `rc_test_${randomBytes(6).toString('hex')}`;
    const sql = postgres(admin, { max: 1, onnotice: () => {} });
    await sql.unsafe(`CREATE DATABASE ${name}`);
    await sql.end();
    const url = new URL(admin);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
  }
}

export type MockLlm = {
  url: string;
  port: number;
  requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[];
  close: () => Promise<void>;
  setHandler: (h: Handler) => void;
  /** 応答を返すまでの待ち時間（ミリ秒） */
  setDelay: (ms: number) => void;
};

type Handler = (req: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }) => { status: number; body: unknown };

/** OpenAI互換APIのモックサーバー（取引判断のJSONを返す） */
export async function startMockLlm(): Promise<MockLlm> {
  const requests: MockLlm['requests'] = [];
  let delay = 0;
  let handler: Handler = (req) => {
    if (req.headers.authorization !== 'Bearer sk-test-valid-key-1234') {
      return { status: 401, body: { error: { message: 'Incorrect API key provided: sk-test-****', type: 'invalid_request_error' } } };
    }
    if (req.url.endsWith('/models')) return { status: 200, body: { data: [{ id: 'mock-model' }, { id: 'mock-judge' }] } };
    const body = JSON.parse(req.body);
    if (body.model !== 'mock-model' && body.model !== 'mock-judge') {
      return { status: 404, body: { error: { message: `The model ${body.model} does not exist` } } };
    }
    const isJudge = String(body.messages?.[0]?.content ?? '').includes('審査員');
    const content = isJudge
      ? JSON.stringify({ score: 4, summary: '概ね規則に沿っている', issues: [] })
      : JSON.stringify({ action: 'buy', quantity: 10, referenced_rules: [1, 2, 4], rationale: '上限内で購入' });
    return {
      status: 200,
      body: {
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } },
      },
    };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(r);
      const out = handler(r);
      setTimeout(() => {
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.body));
      }, delay);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    port,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    setHandler: (h) => (handler = h),
    setDelay: (ms) => (delay = ms),
  };
}
