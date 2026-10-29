import { after } from 'next/server';
import { getCronSecret, isVercel } from '../env';
import { safeMessage } from '../security/redact';
import { runPendingWork } from './experiments';
import { getSettings } from './settings';
import { purgeTracesOlderThan } from '../storage/traceStore';

// 実験ジョブの起動。
// - リクエストへの応答後に after() で1スライス分処理する（Vercel では関数の最大実行時間内）。
// - 処理が残っていれば、Vercel ではワーカーAPIを呼び出して次の関数実行に引き継ぐ。
//   ローカルなど常駐サーバーでは同じプロセスで続けて処理する。
// - Vercel Cron（vercel.json）がワーカーAPIを定期的に呼び、引き継ぎが途切れても再開する。

/** 1スライスの時間予算。関数の最大実行時間（maxDuration = 300 秒）より短くし、実行中のエピソードが終わる余裕を残す */
export const SLICE_BUDGET_MS = Number(process.env.RESEARCH_SLICE_SECONDS || 200) * 1000;

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

async function continueOn(origin: string) {
  const secret = getCronSecret();
  if (!secret) return;
  try {
    // ワーカーAPIはすぐに 202 を返し、処理は呼び出し先の関数で行われる
    const res = await fetch(`${origin}/api/research/worker`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error(`[worker] 次のスライスを開始できませんでした（HTTP ${res.status}）。Cron による再開を待ちます。`);
  } catch (e) {
    console.error(`[worker] 次のスライスを開始できませんでした: ${safeMessage(e)}`);
  }
}

const g = globalThis as typeof globalThis & { __tracePurgedAt?: number };

/** 保存期間を過ぎたトレースを削除する（インスタンスごとに1時間に1回まで） */
async function purgeExpiredTraces() {
  if (Date.now() - (g.__tracePurgedAt ?? 0) < 60 * 60_000) return;
  g.__tracePurgedAt = Date.now();
  try {
    const { traceRetentionDays } = (await getSettings()).observability;
    const removed = await purgeTracesOlderThan(traceRetentionDays);
    if (removed > 0) console.log(`[worker] 保存期間（${traceRetentionDays}日）を過ぎたトレースを ${removed} 件削除しました。`);
  } catch (e) {
    console.error(`[worker] トレースの削除に失敗しました: ${safeMessage(e)}`);
  }
}

/** 処理待ちの実験を1スライス分処理し、残りがあれば次のスライスを予約する */
export async function drainWork(origin: string | null): Promise<void> {
  await purgeExpiredTraces();
  let more: boolean;
  try {
    more = await runPendingWork(SLICE_BUDGET_MS);
  } catch (e) {
    console.error(`[worker] 実験の処理中にエラーが発生しました: ${safeMessage(e)}`);
    return;
  }
  if (!more) return;
  if (isVercel()) {
    if (origin) await continueOn(origin);
  } else {
    // 常駐サーバーでは同じプロセスで続けて処理する
    setTimeout(() => void drainWork(origin), 0);
  }
}

/** Route Handler から呼ぶ: 応答後に実験の処理を進める */
export function scheduleWork(request: Request) {
  const origin = requestOrigin(request);
  after(() => drainWork(origin));
}
