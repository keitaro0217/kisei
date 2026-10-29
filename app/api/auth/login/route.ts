import { apiError, json, readJson } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { getAuthProvider } from '@/lib/server/auth';
import { createSessionToken, safeNextPath, sessionCookieHeader } from '@/lib/server/auth/session';
import { isProduction } from '@/lib/server/env';
import { ValidationError } from '@/lib/server/research/providers';
import { authFailureLimiter, clientKey } from '@/lib/server/security/requestGuards';

/** ログイン画面からのパスワード照合。成功するとセッション Cookie（HttpOnly）を発行する */
export async function POST(request: Request) {
  const client = clientKey(request.headers);
  const locked = authFailureLimiter.lockedFor(client);
  if (locked > 0) {
    const minutes = Math.ceil(locked / 60_000);
    return apiError(429, 'too_many_attempts', `パスワードの誤りが続いたため、約${minutes}分間ログインできません。時間をおいてから再度お試しください。`);
  }
  const provider = getAuthProvider();
  if (!provider) {
    if (isProduction()) return apiError(503, 'auth_misconfigured', 'サーバーの認証設定が完了していません。管理者に連絡してください。');
    return json({ ok: true, next: '/research' });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 4096);
  } catch (e) {
    if (e instanceof ValidationError) return apiError(400, 'validation_error', e.message);
    throw e;
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || !provider.verifyPassword(password)) {
    authFailureLimiter.recordFailure(client);
    await audit('anonymous', 'auth.login', null, 'failure');
    return apiError(401, 'invalid_password', 'パスワードが正しくありません。');
  }
  authFailureLimiter.recordSuccess(client);
  await audit('basic:shared', 'auth.login', null, 'success');
  const response = json({ ok: true, next: safeNextPath(typeof body.next === 'string' ? body.next : null) });
  response.headers.append('Set-Cookie', sessionCookieHeader(createSessionToken(password), isProduction()));
  return response;
}
