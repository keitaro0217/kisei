import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticateHeaders } from '@/lib/server/auth';
import { idleMinutes, safeNextPath } from '@/lib/server/auth/session';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'ログイン | kisei' };

const REASONS: Record<string, string> = {
  idle: '一定時間操作がなかったため、ロックしました。',
  logout: 'ログアウトしました。',
  expired: 'ログインの有効期限が切れました。',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }> }) {
  const params = await searchParams;
  const raw = params.next;
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw);
  const reason = REASONS[String(Array.isArray(params.reason) ? params.reason[0] : (params.reason ?? ''))] ?? null;
  // すでにログインしている場合はそのまま移動する
  if (authenticateHeaders(await headers()).ok) redirect(next);
  return (
    <div className="research-root flex min-h-screen items-center justify-center px-4 py-10">
      <main className="rc-glass w-full max-w-sm rounded-2xl px-7 py-8">
        <div className="mb-7 text-center">
          <span className="rc-primary mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold">k</span>
          <h1 className="text-2xl font-bold tracking-tight text-white">kisei</h1>
          <p className="mt-1 text-xs tracking-wide text-ink-300">Regulatory AI Research Console</p>
        </div>
        {reason && (
          <p role="status" className="mb-4 rounded-lg bg-white/5 px-3 py-2 text-center text-xs text-ink-100 ring-1 ring-inset ring-white/10">
            {reason}
          </p>
        )}
        <LoginForm next={next} idleMinutes={idleMinutes()} />
      </main>
    </div>
  );
}
