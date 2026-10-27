import type { Metadata } from 'next';
import { headers } from 'next/headers';
import ResearchShell from '@/components/research/ResearchShell';
import { authenticateHeaders } from '@/lib/server/auth';
import { getSettings } from '@/lib/server/research/settings';

export const metadata: Metadata = {
  title: '研究コンソール',
  description: '規制解釈AIの研究実験・API連携管理',
};

export default async function ResearchLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts に加えて、サーバー側の描画時にも認証を再確認する
  const auth = authenticateHeaders(await headers());
  if (!auth.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center research-root p-6 text-center text-sm text-ink-200">
        {auth.reason === 'misconfigured' ? 'サーバーの認証設定が完了していません。管理者に連絡してください。' : '認証が必要です。ページを再読み込みしてください。'}
      </div>
    );
  }
  const settings = await getSettings();
  return (
    <ResearchShell basic={settings.basic} principal={auth.principal.displayName}>
      {children}
    </ResearchShell>
  );
}
