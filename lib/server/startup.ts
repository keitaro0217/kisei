import { isProduction, isVercel, validateRequiredEnv } from './env';

// サーバー起動時の処理（instrumentation.ts の register から Node.js ランタイムでのみ呼ばれる）。

export function checkEnvironment() {
  const problems = validateRequiredEnv();
  if (problems.length === 0) return;
  // 値は出力せず、変数名と問題点のみを表示する
  const lines = problems.map((p) => `  - ${p.variable}: ${p.problem}`).join('\n');
  if (isProduction() && isVercel()) {
    // Vercel ではプロセスを止めると原因が画面に出ないため停止しない。
    // 代わりに proxy.ts が全リクエストを止め、認証済みの利用者に問題の変数名を表示する
    console.error(`[startup] 必須の環境変数が正しく設定されていません。設定するまでアプリは利用できません。\n${lines}`);
    return;
  }
  if (isProduction()) {
    console.error(`[startup] 必須の環境変数が正しく設定されていないため起動を中止します。\n${lines}`);
    process.exit(1);
  }
  console.warn(`[startup] 開発モード: 以下の環境変数が未設定です。本番環境では起動できません。\n${lines}`);
}

/** 常駐サーバー（Vercel 以外）では、起動時に実行中だった実験の処理を再開する */
export function resumeBackgroundWork() {
  if (isVercel() || process.env.RESEARCH_WORKER_AUTOSTART === '0') return;
  setTimeout(() => {
    import('./research/scheduler')
      .then(({ drainWork }) => drainWork(null))
      .catch(() => console.error('[startup] 実験ワーカーを開始できませんでした'));
  }, 3_000);
}
