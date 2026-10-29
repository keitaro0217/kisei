import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ログイン画面で発行するセッション（Cookie）。
// - Cookie の値は「有効期限.署名」のみで、パスワードや個人情報は含めない。
// - 署名鍵はパスワードから導出するため、パスワードを変更すると既存のセッションはすべて無効になる。
// - サーバー側に状態を持たないため、サーバーレス（複数インスタンス）でもそのまま検証できる。

export const SESSION_COOKIE = 'kisei_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const keyOf = (password: string) => createHash('sha256').update(`kisei-session-v1|${password}`, 'utf8').digest();
const sign = (password: string, payload: string) => createHmac('sha256', keyOf(password)).update(payload).digest('base64url');

export function createSessionToken(password: string, nowMs = Date.now()): string {
  const payload = `v1.${Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS}`;
  return `${payload}.${sign(password, payload)}`;
}

export function verifySessionToken(token: string | null | undefined, password: string, nowMs = Date.now()): boolean {
  if (!token || token.length > 200) return false;
  const m = /^(v1\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const expected = Buffer.from(sign(password, m[1]));
  const actual = Buffer.from(m[3]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(m[2]) * 1000 > nowMs;
}

export function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** ログイン後の移動先。外部サイトへの誘導（オープンリダイレクト）を防ぐため、同一サイト内のパスだけを許可する */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) return '/research';
  return next;
}
