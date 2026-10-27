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

export function unauthorizedResponse(result: Exclude<AuthResult, { ok: true }>): Response {
  if (result.reason === 'misconfigured') {
    return Response.json(
      { error: { code: 'auth_misconfigured', message: 'サーバーの認証設定が完了していません。管理者に連絡してください。' } },
      { status: 503 },
    );
  }
  const provider = getAuthProvider();
  return Response.json(
    { error: { code: 'unauthorized', message: '認証が必要です。' } },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': provider?.challenge() ?? 'Basic realm="Research Console"',
        'Cache-Control': 'no-store',
      },
    },
  );
}

export function forbiddenResponse(): Response {
  return Response.json({ error: { code: 'forbidden', message: 'この操作を行う権限がありません。' } }, { status: 403 });
}

/**
 * Route Handler 用の認証チェック。proxy.ts でも検証しているが、マッチャーの設定漏れなどに
 * 備えてバックエンドの各エンドポイントでも必ず再検証する（多層防御）。
 */
export function requireAuth(request: Request, permission: Permission): Principal | Response {
  const result = authenticateHeaders(request.headers);
  if (!result.ok) return unauthorizedResponse(result);
  if (!result.principal.permissions.includes(permission)) return forbiddenResponse();
  return result.principal;
}
