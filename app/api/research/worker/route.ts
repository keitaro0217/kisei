import { after } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { safeEqual } from '@/lib/server/auth/basicAuth';
import { getCronSecret } from '@/lib/server/env';
import { drainWork, requestOrigin } from '@/lib/server/research/scheduler';

// 実験ワーカーの起動エンドポイント。
// Vercel Cron（Authorization: Bearer $CRON_SECRET）と、処理を引き継ぐ自己呼び出しから使う。
// Basic認証済みの利用者も手動で起動できる。
export const maxDuration = 300;

function authorized(request: Request): boolean | Response {
  const header = request.headers.get('authorization') ?? '';
  const secret = getCronSecret();
  if (secret && header.startsWith('Bearer ')) return safeEqual(header.slice(7), secret);
  const principal = requireAuth(request, 'research:run');
  return principal instanceof Response ? principal : true;
}

async function handle(request: Request) {
  const ok = authorized(request);
  if (ok instanceof Response) return ok;
  if (!ok) return Response.json({ error: { code: 'unauthorized', message: '認証が必要です。' } }, { status: 401 });
  const origin = requestOrigin(request);
  after(() => drainWork(origin));
  return Response.json({ accepted: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;
