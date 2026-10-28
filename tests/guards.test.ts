import { beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// CSRF・総当たり対策・JSON の Content-Type 必須化。

beforeAll(async () => {
  await setupEnv();
});

const basic = (password: string) => `Basic ${Buffer.from(`any:${password}`).toString('base64')}`;

describe('CSRF 対策', () => {
  it('他サイトからの書き込みを拒否し、同一オリジン・ブラウザ以外からは受け付ける', async () => {
    const { isCrossSiteWrite } = await import('@/lib/server/security/requestGuards');
    const h = (o: Record<string, string>) => new Headers(o);
    expect(isCrossSiteWrite('POST', h({ 'sec-fetch-site': 'cross-site' }), 'app.example')).toBe(true);
    expect(isCrossSiteWrite('POST', h({ 'sec-fetch-site': 'same-site' }), 'app.example')).toBe(true);
    expect(isCrossSiteWrite('POST', h({ 'sec-fetch-site': 'same-origin' }), 'app.example')).toBe(false);
    expect(isCrossSiteWrite('POST', h({ origin: 'https://evil.example' }), 'app.example')).toBe(true);
    expect(isCrossSiteWrite('DELETE', h({ origin: 'null' }), 'app.example')).toBe(true);
    expect(isCrossSiteWrite('PUT', h({ origin: 'https://app.example' }), 'app.example')).toBe(false);
    expect(isCrossSiteWrite('POST', h({}), 'app.example')).toBe(false);
    expect(isCrossSiteWrite('GET', h({ 'sec-fetch-site': 'cross-site' }), 'app.example')).toBe(false);
  });

  it('readJson は Content-Type が application/json でない本文を拒否する', async () => {
    const { readJson } = await import('@/lib/server/api');
    await expect(readJson(new Request('https://x/api', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'text/plain' } }))).rejects.toThrow(/application\/json/);
    await expect(readJson(new Request('https://x/api', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json; charset=utf-8' } }))).resolves.toEqual({ a: 1 });
  });
});

describe('総当たり対策', () => {
  it('一定回数の失敗でロックし、時間経過で解除する', async () => {
    const { FailureLimiter } = await import('@/lib/server/security/requestGuards');
    const l = new FailureLimiter(3, 60_000, 10_000);
    l.recordFailure('ip', 0);
    l.recordFailure('ip', 1);
    expect(l.lockedFor('ip', 2)).toBe(0);
    l.recordFailure('ip', 2);
    expect(l.lockedFor('ip', 3)).toBeGreaterThan(0);
    expect(l.lockedFor('other', 3)).toBe(0);
    expect(l.lockedFor('ip', 10_003)).toBe(0);
  });

  it('proxy はパスワードの誤りが続くと 429 を返し、正しいパスワードも照合しない', async () => {
    const { proxy } = await import('@/proxy');
    const { NextRequest } = await import('next/server');
    const req = (password: string | null, ip = '203.0.113.9') =>
      new NextRequest('http://localhost/research', { headers: { 'x-forwarded-for': ip, ...(password ? { authorization: basic(password) } : {}) } });
    expect(proxy(req(null)).status).toBe(401);
    for (let i = 0; i < 9; i++) expect(proxy(req('wrong-password-123')).status).toBe(401);
    // 認証情報なしのリクエストは失敗に数えない（ブラウザの最初のリクエスト）
    expect(proxy(req('wrong-password-123')).status).toBe(401);
    const locked = proxy(req('correct-horse-battery'));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    // 別の接続元は影響を受けない
    expect(proxy(req('correct-horse-battery', '198.51.100.7')).status).toBe(200);
  });

  it('未認証の画面表示には UTF-8 の HTML、API には UTF-8 の JSON を返す（文字化けしない）', async () => {
    const { proxy } = await import('@/proxy');
    const { NextRequest } = await import('next/server');
    const page = proxy(new NextRequest('http://localhost/research', { headers: { 'x-forwarded-for': '192.0.2.50', accept: 'text/html,application/xhtml+xml' } }));
    expect(page.status).toBe(401);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('www-authenticate')).toMatch(/^Basic /);
    expect(await page.text()).toContain('ログインが必要です');
    const apiRes = proxy(new NextRequest('http://localhost/api/research/studies', { headers: { 'x-forwarded-for': '192.0.2.51', accept: '*/*' } }));
    expect(apiRes.status).toBe(401);
    expect(apiRes.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('proxy は他サイトからの POST を 403 で拒否する', async () => {
    const { proxy } = await import('@/proxy');
    const { NextRequest } = await import('next/server');
    const res = proxy(
      new NextRequest('http://localhost/api/research/studies', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.0.2.1', authorization: basic('correct-horse-battery'), 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res.status).toBe(403);
  });
});
