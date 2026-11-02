import { json, withAuth } from '@/lib/server/api';
import { idleMinutes } from '@/lib/server/auth/session';

/**
 * ログイン状態の確認（画面の自動ロック用）。認証済みのときだけ応答し、proxy がこの要求で最終操作時刻を更新する。
 * 認証情報や Cookie の中身は返さない。
 */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ ok: true, idleMinutes: idleMinutes() }));
}
