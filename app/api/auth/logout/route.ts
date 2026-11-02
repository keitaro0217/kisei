import { json } from '@/lib/server/api';
import { clearSessionCookieHeaders } from '@/lib/server/auth/session';
import { isProduction } from '@/lib/server/env';

/** セッション Cookie を削除する */
export async function POST() {
  const response = json({ ok: true });
  for (const c of clearSessionCookieHeaders(isProduction())) response.headers.append('Set-Cookie', c);
  // 対応するブラウザでは、このサイトの Cookie をすべて削除させる（古い形式の Cookie が残っていても確実にログアウトする）
  response.headers.set('Clear-Site-Data', '"cookies"');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
