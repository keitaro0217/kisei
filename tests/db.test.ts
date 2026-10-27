import { describe, expect, it } from 'vitest';

describe('データベース接続文字列', () => {
  it('postgres.js が扱えない libpq 専用のパラメーター（Neon の channel_binding など）を取り除き、sslmode は残す', async () => {
    const { normalizeDatabaseUrl } = await import('@/lib/server/db');
    const url = normalizeDatabaseUrl('postgresql://user:p%40ss@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('sslmode')).toBe('require');
    expect(parsed.searchParams.has('channel_binding')).toBe(false);
    expect(parsed.username).toBe('user');
    expect(parsed.password).toBe('p%40ss');
    expect(parsed.pathname).toBe('/neondb');
  });

  it('URL として解釈できない値はそのまま返す', async () => {
    const { normalizeDatabaseUrl } = await import('@/lib/server/db');
    expect(normalizeDatabaseUrl('not a url')).toBe('not a url');
  });

  // 実際の PostgreSQL がある場合のみ: channel_binding 付きの接続文字列でも接続できることを確かめる
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('Neon 形式（channel_binding=require 付き）の接続文字列で接続できる', async () => {
    const { normalizeDatabaseUrl } = await import('@/lib/server/db');
    const { default: postgres } = await import('postgres');
    const base = new URL(process.env.TEST_DATABASE_URL!);
    base.searchParams.set('channel_binding', 'require');
    const sql = postgres(normalizeDatabaseUrl(base.toString()), { max: 1, prepare: false });
    try {
      const rows = await sql.unsafe('SELECT 1 AS ok');
      expect(rows[0].ok).toBe(1);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
