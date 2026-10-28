import { getBasicAuthConfig, isProduction } from '../env';
import { BasicAuthProvider } from './basicAuth';
import type { AuthProvider, AuthResult, Permission, Principal } from './types';
import { ALL_PERMISSIONS } from './types';

export type { Principal, Permission } from './types';

/** 現在有効な認証プロバイダー。未設定の場合は null（本番では起動を拒否する）。 */
export function getAuthProvider(): AuthProvider | null {
  const config = getBasicAuthConfig();
  return config ? new BasicAuthProvider(config) : null;
}

const developmentPrincipal: Principal = {
  id: 'development:anonymous',
  displayName: '開発モード（認証無効）',
  tenantId: 'default',
  permissions: ALL_PERMISSIONS,
  authMethod: 'development',
};

export function authenticateHeaders(headers: Headers): AuthResult {
  const provider = getAuthProvider();
  if (!provider) {
    // 開発環境でのみ認証なしを許可する。本番では常に拒否（fail closed）
    return isProduction() ? { ok: false, reason: 'misconfigured' } : { ok: true, principal: developmentPrincipal };
  }
  return provider.authenticate(headers);
}

const JSON_UTF8 = 'application/json; charset=utf-8';

/** 画面の表示（ブラウザのページ移動）か。API の呼び出しには JSON、画面には HTML で応答する */
function wantsHtml(headers?: Headers): boolean {
  return Boolean(headers?.get('accept')?.includes('text/html'));
}

const UNAUTHORIZED_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ログインが必要です</title>
<style>body{margin:0;background:#0b0b0b;color:#f0efec;font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:28rem;padding:24px;line-height:1.7}h1{font-size:1.25rem;margin:0 0 12px}p{margin:0 0 10px;color:#c3c2b7;font-size:.95rem}a{display:inline-block;margin-top:8px;padding:8px 16px;border-radius:8px;background:#f0efec;color:#0b0b0b;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>ログインが必要です</h1>
<p>パスワードが入力されていないか、正しくありません。</p>
<p>再読み込みして、表示される入力欄にパスワードを入力してください（ユーザー名は空欄または任意の文字で構いません）。</p>
<p>入力欄が表示されない場合は、アプリ内のブラウザではなく Safari や Chrome で開いてください。</p>
<a href="">再読み込み</a></main></body></html>`;

export function unauthorizedResponse(result: Exclude<AuthResult, { ok: true }>, requestHeaders?: Headers): Response {
  if (result.reason === 'misconfigured') {
    return Response.json(
      { error: { code: 'auth_misconfigured', message: 'サーバーの認証設定が完了していません。管理者に連絡してください。' } },
      { status: 503, headers: { 'Content-Type': JSON_UTF8 } },
    );
  }
  const provider = getAuthProvider();
  const headers = {
    'WWW-Authenticate': provider?.challenge() ?? 'Basic realm="Research Console"',
    'Cache-Control': 'no-store',
  };
  if (wantsHtml(requestHeaders)) {
    return new Response(UNAUTHORIZED_HTML, { status: 401, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return Response.json({ error: { code: 'unauthorized', message: '認証が必要です。' } }, { status: 401, headers: { ...headers, 'Content-Type': JSON_UTF8 } });
}

export function forbiddenResponse(): Response {
  return Response.json({ error: { code: 'forbidden', message: 'この操作を行う権限がありません。' } }, { status: 403, headers: { 'Content-Type': JSON_UTF8 } });
}

/**
 * Route Handler 用の認証チェック。proxy.ts でも検証しているが、マッチャーの設定漏れなどに
 * 備えてバックエンドの各エンドポイントでも必ず再検証する（多層防御）。
 */
export function requireAuth(request: Request, permission: Permission): Principal | Response {
  const result = authenticateHeaders(request.headers);
  if (!result.ok) return unauthorizedResponse(result, request.headers);
  if (!result.principal.permissions.includes(permission)) return forbiddenResponse();
  return result.principal;
}
