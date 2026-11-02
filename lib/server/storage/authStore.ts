import { createHash } from 'node:crypto';
import { getDb } from '../db';

// ログイン試行の制限（データベースで共有する）。サーバーレスでインスタンスが分かれても、同じ接続元の失敗を合算する。
// 接続元は SHA-256 のハッシュで保存し、IP アドレスそのものは保存しない。

export const LOGIN_MAX_FAILURES = 10;
const WINDOW_MINUTES = 15;
const LOCK_MINUTES = 15;

export const attemptKey = (client: string) => `ip:${createHash('sha256').update(`kisei-login|${client}`).digest('hex').slice(0, 32)}`;

/** ロック中なら残り時間（ミリ秒）、そうでなければ 0 */
export async function loginLockedFor(key: string): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ ms: number | null }>(`SELECT (extract(epoch FROM (locked_until - now())) * 1000)::bigint AS ms FROM rc_auth_attempts WHERE key = $1 AND locked_until > now()`, [key]);
  return rows[0]?.ms ? Number(rows[0].ms) : 0;
}

/** 失敗を記録する。期間内の失敗が上限に達したらロックする。ロックした場合 true */
export async function recordLoginFailure(key: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ failures: number; locked: boolean }>(
    `INSERT INTO rc_auth_attempts (key, window_start, failures, locked_until) VALUES ($1, now(), 1, NULL)
     ON CONFLICT (key) DO UPDATE SET
       failures = CASE WHEN rc_auth_attempts.window_start < now() - ($2::int * interval '1 minute') THEN 1 ELSE rc_auth_attempts.failures + 1 END,
       window_start = CASE WHEN rc_auth_attempts.window_start < now() - ($2::int * interval '1 minute') THEN now() ELSE rc_auth_attempts.window_start END
     RETURNING failures, false AS locked`,
    [key, WINDOW_MINUTES],
  );
  if (rows[0].failures >= LOGIN_MAX_FAILURES) {
    await db.query(`UPDATE rc_auth_attempts SET locked_until = now() + ($2::int * interval '1 minute'), failures = 0, window_start = now() WHERE key = $1`, [key, LOCK_MINUTES]);
    return true;
  }
  return false;
}

export async function clearLoginFailures(key: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM rc_auth_attempts WHERE key = $1', [key]);
}
