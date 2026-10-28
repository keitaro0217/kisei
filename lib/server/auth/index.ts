import { getBasicAuthConfig, isProduction } from '../env';
import { BasicAuthProvider } from './basicAuth';
import { safeNextPath } from './session';
import type { AuthResult, Permission, Principal } from './types';
import { ALL_PERMISSIONS } from './types';

export type { Principal, Permission } from './types';

/** 現在有効な認証プロバイダー。未設定の場合は null（本番では起動を拒否する）。 */
export function getAuthProvider(): BasicAuthProvider | null {
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

/** 画面の表示（ブラウザのページ移動）か。画面はログイン画面へ移動し、API の呼び出しには JSON で応答する */
function wantsHtml(headers?: Headers): boolean {
  return Boolean(headers?.get('accept')?.includes('text/html'));
}

/**
 * 未認証時の応答。ブラウザの認証ダイアログ（WWW-Authenticate）は使わず、
 * 画面はアプリのログイン画面（/login）へ移動させる。
 */
export function unauthorizedResponse(result: Exclude<AuthResult, { ok: true }>, request?: Request): Response {
  if (result.reason === 'misconfigured') {
    return Response.json(
      { error: { code: 'auth_misconfigured', message: 'サーバーの認証設定が完了していません。管理者に連絡してください。' } },
      { status: 503, headers: { 'Content-Type': JSON_UTF8 } },
    );
  }
  if (request && request.method === 'GET' && wantsHtml(request.headers)) {
    const url = new URL(request.url);
    const login = new URL(`/login?next=${encodeURIComponent(safeNextPath(`${url.pathname}${url.search}`))}`, url);
    return new Response(null, { status: 303, headers: { Location: login.toString(), 'Cache-Control': 'no-store' } });
  }
  return Response.json(
    { error: { code: 'unauthorized', message: 'ログインが必要です。ページを再読み込みしてログインしてください。' } },
    { status: 401, headers: { 'Cache-Control': 'no-store', 'Content-Type': JSON_UTF8 } },
  );
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
  if (!result.ok) return unauthorizedResponse(result, request);
  if (!result.principal.permissions.includes(permission)) return forbiddenResponse();
  return result.principal;
}
