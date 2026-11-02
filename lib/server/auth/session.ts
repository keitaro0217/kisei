import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ログイン画面で発行するセッション（Cookie）。
// - Cookie の値は「発行時刻.最終操作時刻.署名」のみで、パスワードや個人情報は含めない。
// - 署名鍵はパスワード（と任意の SESSION_SECRET）から導出するため、どちらかを変更すると既存のセッションはすべて無効になる。
// - サーバー側に状態を持たないため、サーバーレス（複数インスタンス）でもそのまま検証できる。
// - Cookie は有効期限を付けない「ブラウザセッション Cookie」とし、ブラウザを閉じると消える。
//   ただしブラウザのセッション復元で Cookie が残ることがあるため、期限はサーバー側でも必ず検証する:
//   操作がない時間（アイドル）と、ログインからの最長時間（絶対期限）のどちらかを過ぎたら無効。

export const SESSION_COOKIE = 'kisei_session';
/** 本番（HTTPS）では __Host- 接頭辞を使い、Secure・Path=/・Domain なしを強制する */
export const SECURE_SESSION_COOKIE = '__Host-kisei_session';

/** 最終操作時刻を更新する間隔（毎回 Cookie を書き換えないため） */
const REFRESH_AFTER_SECONDS = 60;

const intEnv = (name: string, def: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

/** 操作がないまま経過するとログインが必要になる時間（分）。既定 30 分 */
export const idleMinutes = () => intEnv('SESSION_IDLE_MINUTES', 30, 5, 720);
/** ログインから最長でこの時間（時間）が経つと、操作していても再ログインが必要。既定 12 時間 */
export const maxHours = () => intEnv('SESSION_MAX_HOURS', 12, 1, 72);

const keyOf = (password: string) =>
  createHash('sha256')
    .update(`kisei-session-v2|${process.env.SESSION_SECRET ?? ''}|${password}`, 'utf8')
    .digest();
const sign = (password: string, payload: string) => createHmac('sha256', keyOf(password)).update(payload).digest('base64url');

function issue(password: string, issuedAt: number, lastActive: number): string {
  const payload = `v2.${issuedAt}.${lastActive}`;
  return `${payload}.${sign(password, payload)}`;
}

export function createSessionToken(password: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  return issue(password, now, now);
}

export type SessionCheck = { ok: false } | { ok: true; issuedAt: number; lastActive: number; refreshed: string | null };

/** 署名・アイドル期限・絶対期限を検証する。最終操作時刻が古ければ、更新したトークンを refreshed に返す */
export function checkSessionToken(token: string | null | undefined, password: string, nowMs = Date.now()): SessionCheck {
  if (!token || token.length > 200) return { ok: false };
  const m = /^(v2\.(\d{1,12})\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return { ok: false };
  const expected = Buffer.from(sign(password, m[1]));
  const actual = Buffer.from(m[4]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false };
  const now = Math.floor(nowMs / 1000);
  const issuedAt = Number(m[2]);
  const lastActive = Number(m[3]);
  // 未来の時刻（改ざん・時計のずれ）は1分まで許容する
  if (issuedAt > now + 60 || lastActive > now + 60 || lastActive < issuedAt) return { ok: false };
  if (now - issuedAt > maxHours() * 3600) return { ok: false };
  if (now - lastActive > idleMinutes() * 60) return { ok: false };
  const refreshed = now - lastActive >= REFRESH_AFTER_SECONDS ? issue(password, issuedAt, now) : null;
  return { ok: true, issuedAt, lastActive, refreshed };
}

export function verifySessionToken(token: string | null | undefined, password: string, nowMs = Date.now()): boolean {
  return checkSessionToken(token, password, nowMs).ok;
}

export function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** リクエストのセッショントークン（本番の __Host- 付きを優先） */
export const readSessionToken = (headers: Headers) => readCookie(headers, SECURE_SESSION_COOKIE) ?? readCookie(headers, SESSION_COOKIE);

/** 有効期限を付けないブラウザセッション Cookie（ブラウザを閉じると消える）。期限はサーバー側で検証する */
export function sessionCookieHeader(token: string, secure: boolean): string {
  return `${secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** ログアウト: 両方の名前の Cookie を削除する */
export function clearSessionCookieHeaders(secure: boolean): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    ...(secure ? [`${SECURE_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`] : []),
  ];
}

/** ログイン後の移動先。外部サイトへの誘導（オープンリダイレクト）を防ぐため、同一サイト内のパスだけを許可する */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login') || next.startsWith('/api/')) return '/research';
  if (/[\u0000-\u001f]/.test(next)) return '/research';
  return next;
}
