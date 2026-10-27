export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { isProduction, validateRequiredEnv } = await import('./lib/server/env');
  const problems = validateRequiredEnv();
  if (problems.length === 0) return;

  // 値は出力せず、変数名と問題点のみを表示する
  const lines = problems.map((p) => `  - ${p.variable}: ${p.problem}`).join('\n');
  if (isProduction()) {
    console.error(`[startup] 必須の環境変数が正しく設定されていないため起動を中止します。\n${lines}`);
    process.exit(1);
  }
  console.warn(`[startup] 開発モード: 以下の環境変数が未設定です。本番環境では起動できません。\n${lines}`);
}
