import { apiError, json, readJson } from '@/lib/server/api';
import { hashToken, ingestEvents, RateLimitError } from '@/lib/server/research/monitor/monitor';
import { ValidationError } from '@/lib/server/research/providers';
import { authFailureLimiter, clientKey } from '@/lib/server/security/requestGuards';
import { safeMessage } from '@/lib/server/security/redact';
import { getSourceByTokenHash } from '@/lib/server/storage/monitorStore';

// 監視イベントの取り込み（試験版）。接続元ごとのトークン（Authorization: Bearer ksm_...）で認証する。
// 本文は { events: [...] }（最大100件）または1件のイベント。スキーマ外の項目は拒否する。

export async function POST(request: Request) {
  const client = clientKey(request.headers);
  if (authFailureLimiter.lockedFor(client) > 0) return apiError(429, 'too_many_attempts', '認証の失敗が続いたため、しばらく時間をおいてください。');
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const source = /^ksm_[A-Za-z0-9_-]{43}$/.test(token) ? await getSourceByTokenHash(hashToken(token)) : null;
  if (!source || source.disabled) {
    authFailureLimiter.recordFailure(client);
    return apiError(401, 'unauthorized', '接続元のトークンが正しくないか、無効になっています。');
  }
  try {
    return json(await ingestEvents(source, await readJson(request, 256 * 1024)), 202);
  } catch (e) {
    if (e instanceof ValidationError) return apiError(400, 'validation_error', e.message);
    if (e instanceof RateLimitError) return apiError(429, 'rate_limited', e.message);
    console.error(`[monitor] 取り込みに失敗しました: ${safeMessage(e, [token])}`);
    return apiError(500, 'internal_error', 'サーバーでエラーが発生しました。');
  }
}
