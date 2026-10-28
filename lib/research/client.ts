'use client';

import type { BasicSettings } from './types';

// ブラウザから研究APIを呼ぶための薄いラッパー。
// 認証はブラウザが保持するBasic認証情報で行われ、APIキーなどはブラウザに保存しない。

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly label?: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/research${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 本文なし
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; label?: string; field?: string } } | null)?.error;
    if (res.status === 401) {
      // ログインの有効期限が切れた場合はログイン画面へ移動する
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      throw new ApiError(401, 'unauthorized', 'ログインの有効期限が切れました。ログインし直してください。');
    }
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `エラーが発生しました（${res.status}）`, err?.label, err?.field);
  }
  return data as T;
}

export const formatUsd = (n: number | null | undefined, digits = 4) =>
  n === null || n === undefined ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;

export const formatInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('ja-JP'));

export function formatDate(value: string | null | undefined, basic?: Pick<BasicSettings, 'timeZone' | 'dateFormat'>): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const tz = basic?.timeZone ?? 'Asia/Tokyo';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const fmt = basic?.dateFormat ?? 'yyyy/MM/dd HH:mm';
  return fmt.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute);
}
