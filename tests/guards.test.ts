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

describe('ログイン画面のセッション', () => {
  it('正しいパスワードでセッション Cookie を発行し、その Cookie で認証できる。誤りは 401 で、続くと 429', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const { authenticateHeaders } = await import('@/lib/server/auth');
    const login = (password: string, ip: string, next?: string) =>
      POST(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ password, next }) }));
    const ok = await login('correct-horse-battery', '198.51.100.20', '//evil.example/');
    expect(ok.status).toBe(200);
    expect((await ok.json()).next).toBe('/research');
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^kisei_session=v1\.\d+\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Lax/);
    expect(cookie).not.toContain('correct-horse-battery');
    const token = cookie.split(';')[0];
    expect(authenticateHeaders(new Headers({ cookie: `other=1; ${token}` })).ok).toBe(true);
    // 改ざんした Cookie は拒否する
    expect(authenticateHeaders(new Headers({ cookie: token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })).ok).toBe(false);
    for (let i = 0; i < 9; i++) expect((await login('wrong-password-123', '198.51.100.21')).status).toBe(401);
    const tenth = await login('wrong-password-123', '198.51.100.21');
    expect(tenth.status).toBe(401);
    expect((await login('correct-horse-battery', '198.51.100.21')).status).toBe(429);
  });

  it('有効期限切れ・別のパスワードで署名したセッションは無効', async () => {
    const { createSessionToken, verifySessionToken, safeNextPath } = await import('@/lib/server/auth/session');
    const t = createSessionToken('pw-one-123456', 0);
    expect(verifySessionToken(t, 'pw-one-123456', 1000)).toBe(true);
    expect(verifySessionToken(t, 'pw-one-123456', 13 * 3600 * 1000)).toBe(false);
    expect(verifySessionToken(t, 'pw-two-123456', 1000)).toBe(false);
    expect(safeNextPath('/research/rules')).toBe('/research/rules');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/login', null]) expect(safeNextPath(bad)).toBe('/research');
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

  it('未認証の画面表示はログイン画面へ移動し、API には UTF-8 の JSON を返す（認証ダイアログは出さない）', async () => {
    const { proxy } = await import('@/proxy');
    const { NextRequest } = await import('next/server');
    const page = proxy(new NextRequest('http://localhost/research/studies?x=1', { headers: { 'x-forwarded-for': '192.0.2.50', accept: 'text/html,application/xhtml+xml' } }));
    expect(page.status).toBe(303);
    expect(page.headers.get('location')).toBe(`http://localhost/login?next=${encodeURIComponent('/research/studies?x=1')}`);
    expect(page.headers.get('www-authenticate')).toBeNull();
    const apiRes = proxy(new NextRequest('http://localhost/api/research/studies', { headers: { 'x-forwarded-for': '192.0.2.51', accept: '*/*' } }));
    expect(apiRes.status).toBe(401);
    expect(apiRes.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(apiRes.headers.get('www-authenticate')).toBeNull();
    // ログイン画面とログイン API は認証なしで通す
    expect(proxy(new NextRequest('http://localhost/login', { headers: { 'x-forwarded-for': '192.0.2.52', accept: 'text/html' } })).status).toBe(200);
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
