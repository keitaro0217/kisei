import { json } from '@/lib/server/api';
import { clearSessionCookieHeaders } from '@/lib/server/auth/session';
import { isProduction } from '@/lib/server/env';

/** セッション Cookie を削除する */
export async function POST() {
  const response = json({ ok: true });
  for (const c of clearSessionCookieHeaders(isProduction())) response.headers.append('Set-Cookie', c);
  return response;
}
