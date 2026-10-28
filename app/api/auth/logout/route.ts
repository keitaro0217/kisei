import { json } from '@/lib/server/api';
import { clearSessionCookieHeader } from '@/lib/server/auth/session';
import { isProduction } from '@/lib/server/env';

/** セッション Cookie を削除する */
export async function POST() {
  const response = json({ ok: true });
  response.headers.append('Set-Cookie', clearSessionCookieHeader(isProduction()));
  return response;
}
