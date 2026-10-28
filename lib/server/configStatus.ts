import type { EnvProblem } from './env';

// 必須の環境変数に問題がある場合の応答。
// Vercel ではプロセスを停止すると原因が画面に出ないため、認証済みの利用者にだけ
// 問題のある「変数名」と「理由」を表示する（値は表示しない）。

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function configProblemsResponse(pathname: string, problems: EnvProblem[]): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (pathname.startsWith('/api/')) {
    return Response.json(
      { error: { code: 'config_incomplete', message: '必須の環境変数が正しく設定されていません。', problems } },
      { status: 503, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
  const items = problems.map((p) => `<li><code>${escapeHtml(p.variable)}</code>：${escapeHtml(p.problem)}</li>`).join('');
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>設定が完了していません</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050506;color:#e6e6e9;font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic UI','Meiryo',system-ui,sans-serif;padding:16px}
.card{max-width:560px;width:100%;background:#17171a;border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:24px;line-height:1.7;font-size:14px}
h1{font-size:18px;margin:0 0 8px;color:#fff}ul{padding-left:20px}code{color:#fff;background:#232328;padding:1px 6px;border-radius:4px}.note{color:#a3a3ab;font-size:13px}</style></head>
<body><div class="card"><h1>環境変数の設定が完了していません</h1><p>次の環境変数を確認してください。</p><ul>${items}</ul>
<p class="note">Vercel の「設定 → 環境変数」で修正したあと、「デプロイメント」から再デプロイ（Redeploy）してください。値はこの画面には表示されません。</p></div></body></html>`;
  return new Response(html, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}
