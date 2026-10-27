import type { LlmErrorCategory } from '@/lib/research/types';
import { errorCategoryLabels } from '@/lib/research/labels';
import { HttpNetworkError, HttpTimeoutError } from '../http/safeHttp';
import { SsrfError } from '../security/ssrf';
import { safeMessage } from '../security/redact';

export class LlmError extends Error {
  constructor(
    public readonly category: LlmErrorCategory,
    message: string,
    public readonly status: number | null = null,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  get retryable(): boolean {
    return ['rate_limit', 'network', 'timeout', 'server_error'].includes(this.category);
  }

  /** 画面表示用（分類ラベル + 秘密情報を除去した詳細） */
  toDisplay(): { category: LlmErrorCategory; label: string; message: string } {
    return { category: this.category, label: errorCategoryLabels[this.category], message: this.message };
  }
}

/** プロバイダーのエラー応答本文から message を取り出す（秘密情報は除去） */
export function extractProviderMessage(body: string, secrets: (string | null)[]): string {
  try {
    const json = JSON.parse(body);
    const msg = json?.error?.message ?? json?.message ?? json?.error ?? json?.detail;
    if (typeof msg === 'string') return safeMessage(msg, secrets);
  } catch {
    // JSON 以外
  }
  return safeMessage(body.slice(0, 200), secrets);
}

export function classifyHttpError(status: number, body: string, secrets: (string | null)[], retryAfter?: string | string[]): LlmError {
  const message = extractProviderMessage(body, secrets);
  const lower = `${message} ${body.slice(0, 500)}`.toLowerCase();
  const retryAfterHeader = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  const retryAfterMs = retryAfterHeader && /^\d+(\.\d+)?$/.test(retryAfterHeader) ? Number(retryAfterHeader) * 1000 : null;

  if (status === 401 || /invalid[_ ]api[_ ]key|api key not valid|incorrect api key|authentication_error/.test(lower)) {
    return new LlmError('auth', message || '認証に失敗しました。', status);
  }
  if (status === 403) return new LlmError('permission', message || '権限がありません。', status);
  if (status === 404 || /model.*(not found|does not exist|not supported)|not_found_error/.test(lower)) {
    return new LlmError('model_unavailable', message || 'モデルが見つかりません。', status);
  }
  if (status === 402 || /insufficient_quota|quota|billing|credit balance/.test(lower)) {
    return new LlmError('quota', message || '利用上限に達しました。', status);
  }
  if (status === 429) return new LlmError('rate_limit', message || 'レート制限に達しました。', status, retryAfterMs);
  if (status === 408) return new LlmError('timeout', message || 'タイムアウトしました。', status);
  if (status >= 500) return new LlmError('server_error', message || 'プロバイダー側でエラーが発生しました。', status, retryAfterMs);
  return new LlmError('invalid_request', message || 'リクエストが拒否されました。', status);
}

export function toLlmError(e: unknown, secrets: (string | null)[] = []): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof SsrfError) return new LlmError('ssrf_blocked', e.message);
  if (e instanceof HttpTimeoutError) return new LlmError('timeout', e.message);
  if (e instanceof HttpNetworkError) return new LlmError('network', e.message);
  return new LlmError('unknown', safeMessage(e, secrets));
}
