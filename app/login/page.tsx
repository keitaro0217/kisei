import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticateHeaders } from '@/lib/server/auth';
import { safeNextPath } from '@/lib/server/auth/session';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'ログイン | 規制解釈AI 研究コンソール' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const raw = (await searchParams).next;
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw);
  // すでにログインしている場合はそのまま移動する
  if (authenticateHeaders(await headers()).ok) redirect(next);
  return (
    <div className="research-root flex min-h-screen items-center justify-center px-4 py-10">
      <div className="rc-glass w-full max-w-sm rounded-2xl p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="rc-primary flex h-10 w-10 items-center justify-center rounded-lg text-base font-bold">R</span>
          <div>
            <p className="text-base font-semibold text-white">規制解釈AI 研究コンソール</p>
            <p className="text-xs text-ink-300">Research Console</p>
          </div>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
