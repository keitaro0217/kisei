import { apiError, json, readJson } from '@/lib/server/api';
import { audit } from '@/lib/server/audit';
import { getAuthProvider } from '@/lib/server/auth';
import { createSessionToken, safeNextPath, sessionCookieHeader } from '@/lib/server/auth/session';
import { isProduction } from '@/lib/server/env';
import { ValidationError } from '@/lib/server/research/providers';
import { authFailureLimiter, clientKey } from '@/lib/server/security/requestGuards';
import { attemptKey, clearLoginFailures, loginLockedFor, recordLoginFailure } from '@/lib/server/storage/authStore';

/** 失敗時に応答を遅らせる時間（総当たりの速度を落とす） */
const FAILURE_DELAY_MS = 400;

const lockedResponse = (ms: number) =>
  apiError(429, 'too_many_attempts', `パスワードの誤りが続いたため、約${Math.max(1, Math.ceil(ms / 60_000))}分間ログインできません。時間をおいてから再度お試しください。`);

/**
 * ログイン画面からのパスワード照合。成功するとセッション Cookie（HttpOnly・SameSite=Lax・本番は Secure）を発行する。
 * 試行の制限は、インスタンスのメモリ（即時）とデータベース（インスタンス間で共有）の両方で行う。
 */
export async function POST(request: Request) {
  const client = clientKey(request.headers);
  const key = attemptKey(client);
  const memoryLock = authFailureLimiter.lockedFor(client);
  if (memoryLock > 0) return lockedResponse(memoryLock);
  const provider = getAuthProvider();
  if (!provider) {
    if (isProduction()) return apiError(503, 'auth_misconfigured', 'サーバーの認証設定が完了していません。管理者に連絡してください。');
    return json({ ok: true, next: '/research' });
  }
  let dbLock = 0;
  try {
    dbLock = await loginLockedFor(key);
  } catch {
    // データベースに接続できない場合も、メモリ内の制限は有効なまま照合を続ける
  }
  if (dbLock > 0) return lockedResponse(dbLock);
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
    const locked = await recordLoginFailure(key).catch(() => false);
    await audit('anonymous', 'auth.login', null, 'failure', locked ? '試行回数の上限に達したため接続元を一時的に拒否' : null);
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return apiError(401, 'invalid_password', 'パスワードが正しくありません。もう一度入力してください。');
  }
  authFailureLimiter.recordSuccess(client);
  await clearLoginFailures(key).catch(() => undefined);
  await audit('basic:shared', 'auth.login', null, 'success');
  const response = json({ ok: true, next: safeNextPath(typeof body.next === 'string' ? body.next : null) });
  response.headers.append('Set-Cookie', sessionCookieHeader(createSessionToken(password), isProduction()));
  return response;
}
