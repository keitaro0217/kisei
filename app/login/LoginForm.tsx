'use client';

import { useState } from 'react';

export default function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('パスワードを入力してください。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, next }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `ログインできませんでした（${res.status}）。`);
        setBusy(false);
        return;
      }
      // Cookie を反映させるため、画面全体を読み込み直す
      window.location.assign(data?.next ?? '/research');
    } catch {
      setError('通信に失敗しました。接続を確認してもう一度お試しください。');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="password" className="text-xs font-medium text-ink-100">
        パスワード
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="password"
          name="password"
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full rounded-lg border-0 bg-ink-950/40 px-3 py-2.5 text-base text-white ring-1 ring-inset ring-white/15 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ink-500/50"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-error' : undefined}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="whitespace-nowrap rounded-lg px-3 text-xs text-ink-200 ring-1 ring-inset ring-white/15 hover:text-white"
          aria-pressed={show}
        >
          {show ? '隠す' : '表示'}
        </button>
      </div>
      {error && (
        <p id="login-error" role="alert" className="mt-2 text-sm text-rose-300">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="rc-primary mt-5 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold">
        {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
        ログイン
      </button>
      <p className="mt-4 text-xs leading-relaxed text-ink-300">ログインの状態は12時間保持されます。共有の端末では、使い終わったらログアウトしてください。</p>
    </form>
  );
}
