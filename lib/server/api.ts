import { errorCategoryLabels } from '@/lib/research/labels';
import { requireAuth, type Permission, type Principal } from './auth';
import { EncryptionUnavailableError } from './crypto/secretBox';
import { LlmError } from './llm/errors';
import { ValidationError } from './research/providers';
import { safeMessage } from './security/redact';

// Route Handler 共通処理: 認証の再検証・入力の読み取り・エラー応答の統一。
// エラー応答・ログには秘密情報やリクエストヘッダーを含めない。

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new ValidationError('リクエストが大きすぎます。');
  if (!text) return {};
  // フォーム送信（text/plain 等）による他サイトからのリクエストを受け付けないよう、JSON の宣言を必須にする
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ValidationError('Content-Type は application/json にしてください。');
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError('JSON の形式が正しくありません。');
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function withAuth(
  request: Request,
  permission: Permission,
  handler: (principal: Principal) => Promise<Response>,
): Promise<Response> {
  const principal = requireAuth(request, permission);
  if (principal instanceof Response) return principal;
  try {
    return await handler(principal);
  } catch (e) {
    if (e instanceof ValidationError) return apiError(400, 'validation_error', e.message, e.field ? { field: e.field } : undefined);
    if (e instanceof EncryptionUnavailableError) return apiError(503, 'encryption_unavailable', e.message);
    if (e instanceof LlmError) {
      const status = e.category === 'not_configured' || e.category === 'budget_exceeded' || e.category === 'provider_changed' ? 409 : 502;
      return apiError(status, e.category, e.message, { label: errorCategoryLabels[e.category] });
    }
    console.error(`[api] ${request.method} ${new URL(request.url).pathname}: ${safeMessage(e)}`);
    return apiError(500, 'internal_error', 'サーバーでエラーが発生しました。');
  }
}
