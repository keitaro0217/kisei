import { beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

beforeAll(async () => {
  await setupEnv();
});

describe('Basic認証', () => {
  it('正しい認証情報のみ受け付け、失敗時は401とWWW-Authenticateを返す', async () => {
    const { requireAuth } = await import('@/lib/server/auth');
    const ok = new Request('https://x/api', { headers: { authorization: `Basic ${Buffer.from('researcher:correct-horse-battery').toString('base64')}` } });
    const principal = requireAuth(ok, 'settings:read');
    expect(principal).not.toBeInstanceOf(Response);

    for (const header of [undefined, `Basic ${Buffer.from('researcher:wrong').toString('base64')}`, 'Bearer abc', 'Basic !!!']) {
      const res = requireAuth(new Request('https://x/api', { headers: header ? { authorization: header } : {} }), 'settings:read');
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(401);
      expect((res as Response).headers.get('WWW-Authenticate')).toMatch(/^Basic realm=/);
    }
  });

  it('パスワードにコロンを含む場合も正しく解釈する', async () => {
    const { parseBasicAuthorization } = await import('@/lib/server/auth/basicAuth');
    expect(parseBasicAuthorization(`Basic ${Buffer.from('u:p:a:ss').toString('base64')}`)).toEqual({ username: 'u', password: 'p:a:ss' });
  });

  it('本番環境で認証情報が未設定なら503（fail closed）', async () => {
    const { authenticateHeaders } = await import('@/lib/server/auth');
    const saved = { u: process.env.BASIC_AUTH_USERNAME, env: process.env.NODE_ENV };
    delete process.env.BASIC_AUTH_USERNAME;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(authenticateHeaders(new Headers())).toEqual({ ok: false, reason: 'misconfigured' });
    process.env.BASIC_AUTH_USERNAME = saved.u;
    (process.env as Record<string, string | undefined>).NODE_ENV = saved.env;
  });

  it('必須環境変数の検証で値を出力しない', async () => {
    const { validateRequiredEnv } = await import('@/lib/server/env');
    process.env.BASIC_AUTH_PASSWORD = 'short';
    const problems = validateRequiredEnv();
    expect(problems.map((p) => p.variable)).toContain('BASIC_AUTH_PASSWORD');
    expect(JSON.stringify(problems)).not.toContain('short');
    process.env.BASIC_AUTH_PASSWORD = 'correct-horse-battery';
  });
});

describe('APIキー暗号化', () => {
  it('AES-256-GCMで暗号化し、改ざんや別IDでは復号できない', async () => {
    const { encryptSecret, decryptSecret, maskSecret } = await import('@/lib/server/crypto/secretBox');
    const secret = 'sk-proj-abcdefghijklmnop1234';
    const enc = encryptSecret(secret, 'provider-1');
    expect(enc).not.toContain(secret);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc, 'provider-1')).toBe(secret);
    expect(() => decryptSecret(enc, 'provider-2')).toThrow();
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'), 'provider-1')).toThrow();
    expect(maskSecret(secret)).toBe('sk-••••••••1234');
    expect(maskSecret(secret)).not.toContain('abcdef');
  });
});

describe('秘密情報の除去', () => {
  it('APIキーやAuthorizationヘッダーを伏せる', async () => {
    const { redact } = await import('@/lib/server/security/redact');
    const out = redact('key sk-ant-api03-XYZXYZXYZXYZ and Bearer abcdefghijkl, x-api-key: secretvalue123 AIzaSyA1234567890123456789012', ['custom-secret-9']);
    expect(out).not.toMatch(/XYZXYZ|abcdefghijkl|secretvalue123|AIzaSy/);
    expect(redact('custom-secret-9', ['custom-secret-9'])).toBe('[REDACTED]');
  });
});

describe('SSRF対策', () => {
  it('プライベートアドレス・http・認証情報付きURLを拒否する', async () => {
    const { validateBaseUrl } = await import('@/lib/server/security/ssrf');
    for (const url of [
      'http://api.openai.com/v1',
      'https://127.0.0.1/v1',
      'https://10.0.0.5',
      'https://169.254.169.254/latest',
      'https://[::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://localhost/v1',
      'https://metadata.google.internal/',
      'https://user:pass@api.openai.com/v1',
      'ftp://example.com',
      'https://intranet/',
    ]) {
      expect(() => validateBaseUrl(url), url).toThrow();
    }
    expect(validateBaseUrl('https://api.openai.com/v1/').toString()).toBe('https://api.openai.com/v1');
  });

  it('許可リストのホストのみ http・プライベートアドレスを許可する（メタデータは常に拒否）', async () => {
    process.env.LLM_ALLOWED_PRIVATE_HOSTS = 'localhost:11434,169.254.169.254';
    const { validateBaseUrl, assertResolvedAddressesAllowed } = await import('@/lib/server/security/ssrf');
    expect(() => validateBaseUrl('http://localhost:11434')).not.toThrow();
    expect(() => validateBaseUrl('http://localhost:8080')).toThrow();
    expect(() => validateBaseUrl('http://169.254.169.254')).toThrow();
    expect(() => assertResolvedAddressesAllowed(new URL('https://evil.example.com'), ['93.184.216.34', '10.0.0.1'])).toThrow();
    expect(() => assertResolvedAddressesAllowed(new URL('https://ok.example.com'), ['93.184.216.34'])).not.toThrow();
    delete process.env.LLM_ALLOWED_PRIVATE_HOSTS;
  });

  it('DNS解決結果がプライベートアドレスなら接続しない', async () => {
    const { safeRequest } = await import('@/lib/server/http/safeHttp');
    // localtest.me は 127.0.0.1 に解決される公開ドメイン。DNSが使えない環境では通信エラーになる
    await expect(safeRequest({ method: 'GET', url: 'https://localtest.me/', timeoutMs: 3000 })).rejects.toThrow();
  });
});

describe('料金計算', () => {
  it('単価未設定なら費用を推測しない', async () => {
    const { computeCostUsd } = await import('@/lib/server/research/pricing');
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cachedTokens: 200_000, cacheWriteTokens: 0, reasoningTokens: 1000 };
    expect(computeCostUsd(null, usage)).toBeNull();
    const price = { providerId: 'p', model: 'm', inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.5, cacheWritePerMTok: null, source: 'test', updatedAt: '' };
    // 非キャッシュ 800k * 2 + キャッシュ 200k * 0.5 + 出力 500k * 10
    expect(computeCostUsd(price, usage)).toBeCloseTo(1.6 + 0.1 + 5, 6);
  });
});

describe('仮想市場', () => {
  it('同じシードで同じ価格系列を生成し、規則違反の注文は約定しない', async () => {
    const { generatePrices, applyDecision, parseDecision } = await import('@/lib/server/research/sim/market');
    const config = { steps: 5, initialCash: 1000, initialPrice: 100, volatility: 0.02, rules: { maxOrderQuantity: 5, maxPosition: 8, allowShortSelling: false } };
    expect(generatePrices(config, 42)).toEqual(generatePrices(config, 42));
    const pf = { cash: 1000, position: 0 };
    const big = applyDecision(pf, parseDecision('{"action":"buy","quantity":6,"referenced_rules":[1]}'), 100, config.rules, 0);
    expect(big.executed).toBe(false);
    expect(big.violations[0]).toContain('第1条');
    const ok = applyDecision(pf, parseDecision('結果: {"action":"buy","quantity":5,"referenced_rules":[1,2]}'), 100, config.rules, 1);
    expect(ok.executed).toBe(true);
    expect(pf).toEqual({ cash: 500, position: 5 });
    const short = applyDecision(pf, parseDecision('{"action":"sell","quantity":6,"referenced_rules":[3]}'), 100, config.rules, 2);
    expect(short.violations.some((v) => v.includes('第3条'))).toBe(true);
    expect(parseDecision('not json').parseError).not.toBeNull();
  });
});
