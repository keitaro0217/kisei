import { NextRequest, NextResponse } from 'next/server';
import { authenticateHeaders, unauthorizedResponse } from '@/lib/server/auth';
import { isProduction, validateRequiredEnv } from '@/lib/server/env';
import { configProblemsResponse } from '@/lib/server/configStatus';
import { authFailureLimiter, clientKey, isCrossSiteWrite } from '@/lib/server/security/requestGuards';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

function withSecurityHeaders(response: NextResponse, production: boolean): NextResponse {
  if (production) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

function requestHost(request: NextRequest): string {
  return (request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || request.nextUrl.host).toLowerCase();
}

function requestHostname(request: NextRequest): string {
  return requestHost(request).replace(/:\d+$/, '');
}

function requestProtocol(request: NextRequest): string {
  // TLS終端するリバースプロキシ（Vercel等）の背後では x-forwarded-proto を参照する
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return forwarded || request.nextUrl.protocol.replace(':', '');
}

export function proxy(request: NextRequest) {
  const production = isProduction();

  // パスワードやセッション Cookie を平文で送らないよう、本番ではHTTPS以外を受け付けない。
  // ローカルでの `next start` 動作確認のため、ループバックのみ例外とする。
  if (production && requestProtocol(request) !== 'https' && !LOOPBACK_HOSTS.has(requestHostname(request))) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const url = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `https://${requestHostname(request)}`);
      return NextResponse.redirect(url, 308);
    }
    return NextResponse.json({ error: { code: 'https_required', message: 'HTTPSでアクセスしてください。' } }, { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // 実験ワーカーは Vercel Cron などから Bearer トークン（CRON_SECRET）で呼ばれる。
  // トークンの検証はワーカーの Route Handler 側で定数時間比較により行う。
  if (request.nextUrl.pathname === '/api/research/worker' && request.headers.get('authorization')?.startsWith('Bearer ')) {
    return NextResponse.next();
  }

  // 保存済みの認証情報を悪用した他サイトからの書き込み（CSRF）を拒否する
  if (isCrossSiteWrite(request.method, request.headers, requestHost(request))) {
    return NextResponse.json({ error: { code: 'cross_site_request', message: '他のサイトからの操作は受け付けません。' } }, { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // ログイン画面とログイン・ログアウトの API は認証なしで表示する（照合と総当たり対策は API 側で行う）
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return withSecurityHeaders(NextResponse.next(), production);
  }

  // パスワードの誤りが続いた接続元は一定時間拒否する（パスワードの照合も行わない）
  const client = clientKey(request.headers);
  const locked = authFailureLimiter.lockedFor(client);
  if (locked > 0) {
    return NextResponse.json(
      { error: { code: 'too_many_attempts', message: '認証の失敗が続いたため、しばらく時間をおいてから再度お試しください。' } },
      { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(Math.ceil(locked / 1000)), 'Cache-Control': 'no-store' } },
    );
  }

  const result = authenticateHeaders(request.headers);
  if (!result.ok) {
    // 認証情報なし（ブラウザの最初のリクエスト）は失敗として数えない
    if (result.reason === 'invalid') authFailureLimiter.recordFailure(client);
    return unauthorizedResponse(result, request);
  }
  authFailureLimiter.recordSuccess(client);

  // 本番で必須の環境変数に問題があれば、認証済みの利用者にだけ原因（変数名と理由）を表示して処理を止める
  if (production) {
    const problems = validateRequiredEnv();
    if (problems.length > 0) return configProblemsResponse(request.nextUrl.pathname, problems);
  }

  return withSecurityHeaders(NextResponse.next(), production);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
