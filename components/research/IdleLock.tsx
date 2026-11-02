'use client';

import { useEffect } from 'react';

// 画面の自動ロック。一定時間（サーバーのアイドル期限と同じ）操作がなければログアウトしてログイン画面に移る。
// 操作している間は数分ごとにサーバーへ確認を送り、サーバー側のアイドル期限も延ばす（読むだけの操作でも切れないように）。

const KEEPALIVE_MS = 4 * 60_000;
const CHECK_MS = 15_000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'] as const;

export default function IdleLock({ idleMinutes }: { idleMinutes: number }) {
  useEffect(() => {
    let lastActivity = Date.now();
    let lastPing = Date.now();
    let locking = false;
    const onActivity = () => {
      lastActivity = Date.now();
    };
    const lock = async () => {
      if (locking) return;
      locking = true;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
      const next = window.location.pathname + window.location.search;
      window.location.assign(`/login?reason=idle&next=${encodeURIComponent(next)}`);
    };
    const tick = async () => {
      const now = Date.now();
      if (now - lastActivity > idleMinutes * 60_000) {
        await lock();
        return;
      }
      if (now - lastPing > KEEPALIVE_MS && lastActivity > lastPing) {
        lastPing = now;
        const res = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
        if (res && res.status === 401) window.location.assign(`/login?reason=expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      }
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true });
    const timer = window.setInterval(() => void tick(), CHECK_MS);
    // 別のタブから戻ったとき（スリープ復帰など）にすぐ確認する
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [idleMinutes]);
  return null;
}
