import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import ResearchShell from '@/components/research/ResearchShell';
import { authenticateHeaders } from '@/lib/server/auth';
import { getDatabaseUrl } from '@/lib/server/env';
import { getSettings } from '@/lib/server/research/settings';
import { safeMessage } from '@/lib/server/security/redact';

export const metadata: Metadata = {
  title: '研究コンソール',
  description: '規制解釈AIの研究実験・API連携管理',
};

export default async function ResearchLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts に加えて、サーバー側の描画時にも認証を再確認する
  const auth = authenticateHeaders(await headers());
  if (!auth.ok) {
    if (auth.reason !== 'misconfigured') redirect('/login');
    return (
      <div className="flex min-h-screen items-center justify-center research-root p-6 text-center text-sm text-ink-200">
        サーバーの認証設定が完了していません。管理者に連絡してください。
      </div>
    );
  }
  let settings;
  try {
    settings = await getSettings();
  } catch (e) {
    // 接続文字列（パスワードを含む）は伏せてログに残す
    const code = (e as { code?: string }).code;
    console.error(`[research] 設定を読み込めませんでした${code ? `（${code}）` : ''}: ${safeMessage(e, [getDatabaseUrl()])}`);
    return (
      <div className="research-root flex min-h-screen items-center justify-center p-6">
        <div className="rc-glass max-w-lg rounded-xl p-6 text-sm leading-relaxed text-ink-100">
          <p className="text-base font-semibold text-white">データベースに接続できません</p>
          <p className="mt-2">
            環境変数 <code className="text-white">DATABASE_URL</code> の設定と、データベース（Neon など）が起動しているかを確認してください。
            詳しい原因はホスティング環境のログ（Vercel の「ログ」）に記録されています。
          </p>
        </div>
      </div>
    );
  }
  return (
    <ResearchShell basic={settings.basic} principal={auth.principal.displayName}>
      {children}
    </ResearchShell>
  );
}
