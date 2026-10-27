import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthProvider, AuthResult } from './types';
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

  constructor(private readonly config: { username: string; password: string }) {}

  authenticate(headers: Headers): AuthResult {
    const credentials = parseBasicAuthorization(headers.get('authorization'));
    if (!credentials) return { ok: false, reason: 'missing' };
    // ユーザー名とパスワードは両方とも必ず比較し、どちらが誤っているかを処理時間から推測させない
    const userOk = safeEqual(credentials.username, this.config.username);
    const passOk = safeEqual(credentials.password, this.config.password);
    if (!(userOk && passOk)) return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      principal: {
        id: `basic:${this.config.username}`,
        displayName: this.config.username,
        tenantId: 'default',
        permissions: ALL_PERMISSIONS,
        authMethod: 'basic',
      },
    };
  }

  challenge(): string {
    return `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`;
  }
}
