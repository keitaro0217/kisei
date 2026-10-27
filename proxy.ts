import { NextRequest, NextResponse } from 'next/server';
import { authenticateHeaders, unauthorizedResponse } from '@/lib/server/auth';
import { isProduction } from '@/lib/server/env';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function requestHostname(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || request.nextUrl.host;
  return host.replace(/:\d+$/, '').toLowerCase();
}

function requestProtocol(request: NextRequest): string {
  // TLS終端するリバースプロキシ（Vercel等）の背後では x-forwarded-proto を参照する
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return forwarded || request.nextUrl.protocol.replace(':', '');
}

export function proxy(request: NextRequest) {
  const production = isProduction();

  // Basic認証は平文で認証情報を送るため、本番ではHTTPS以外を受け付けない。
  // ローカルでの `next start` 動作確認のため、ループバックのみ例外とする。
  if (production && requestProtocol(request) !== 'https' && !LOOPBACK_HOSTS.has(requestHostname(request))) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const url = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `https://${requestHostname(request)}`);
      return NextResponse.redirect(url, 308);
    }
    return NextResponse.json({ error: { code: 'https_required', message: 'HTTPSでアクセスしてください。' } }, { status: 403 });
  }

  const result = authenticateHeaders(request.headers);
  if (!result.ok) {
    return unauthorizedResponse(result);
  }

  const response = NextResponse.next();
  if (production) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
