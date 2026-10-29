import { createHash, timingSafeEqual } from 'node:crypto';
import { readCookie, SESSION_COOKIE, verifySessionToken } from './session';
import type { AuthProvider, AuthResult, Principal } from './types';
import { ALL_PERMISSIONS } from './types';

export const BASIC_AUTH_REALM = 'Research Console';

/** 長さの違いも漏らさないよう、SHA-256 ダイジェスト同士を定数時間で比較する。 */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

export function parseBasicAuthorization(header: string | null): { username: string; password: string } | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return null;
  return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

export class BasicAuthProvider implements AuthProvider {
  readonly name = 'basic';

  constructor(private readonly config: { password: string }) {}

  authenticate(headers: Headers): AuthResult {
    // 1. ログイン画面で発行したセッション Cookie（ブラウザからの利用）
    if (verifySessionToken(readCookie(headers, SESSION_COOKIE), this.config.password)) return { ok: true, principal: this.principal('session') };
    // 2. Authorization ヘッダー（スクリプトなどブラウザ以外からの利用）
    const credentials = parseBasicAuthorization(headers.get('authorization'));
    if (!credentials) return { ok: false, reason: 'missing' };
    // パスワードのみで照合する。ユーザー名は空欄でも何を入れてもよい
    if (!safeEqual(credentials.password, this.config.password)) return { ok: false, reason: 'invalid' };
    return { ok: true, principal: this.principal('basic') };
  }

  /** ログイン画面で入力されたパスワードの照合 */
  verifyPassword(password: string): boolean {
    return safeEqual(password, this.config.password);
  }

  private principal(authMethod: 'basic' | 'session'): Principal {
    return {
      // 監査ログ用の識別子。パスワードのみの共有アカウントのため固定値とする
      id: 'basic:shared',
      displayName: '研究チーム',
      tenantId: 'default',
      permissions: ALL_PERMISSIONS,
      authMethod,
    };
  }
}
