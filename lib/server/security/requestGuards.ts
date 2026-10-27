// リクエストの事前チェック（proxy.ts から呼ぶ。Node 固有の API は使わない）。
//
// 1. CSRF 対策: ブラウザは保存した Basic 認証情報を他サイトからのリクエストにも自動で付けるため、
//    状態を変更するメソッドは同一オリジンからのものだけを受け付ける（Fetch Metadata と Origin で判定）。
//    どちらのヘッダーもないリクエスト（curl などブラウザ以外）は CSRF の経路にならないため通す。
// 2. 総当たり対策: パスワードの誤りが続いた接続元を一定時間拒否する。
//    記録はインスタンスのメモリ内のみで、サーバーレスの複数インスタンス間では共有されない（ベストエフォート）。

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isCrossSiteWrite(method: string, headers: Headers, host: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  const site = headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = headers.get('origin');
  if (!origin) return false;
  if (origin === 'null') return true;
  try {
    return new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    return true;
  }
}

export function clientKey(headers: Headers): string {
  // Vercel などのプロキシは x-forwarded-for の先頭に接続元を設定する
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}

type Entry = { failures: number; windowStart: number; lockedUntil: number };

export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
    private readonly maxEntries = 10_000,
  ) {}

  /** ロック中なら残り時間（ミリ秒）、そうでなければ 0 */
  lockedFor(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    let e = this.entries.get(key);
    if (!e || now - e.windowStart > this.windowMs) e = { failures: 0, windowStart: now, lockedUntil: 0 };
    e.failures += 1;
    if (e.failures >= this.maxFailures) {
      e.lockedUntil = now + this.lockMs;
      e.failures = 0;
      e.windowStart = now;
    }
    this.entries.delete(key);
    this.entries.set(key, e);
    // 記録が増えすぎないよう、古いものから捨てる
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }
}

const g = globalThis as typeof globalThis & { __authFailureLimiter?: FailureLimiter };
export const authFailureLimiter = (g.__authFailureLimiter ??= new FailureLimiter());
