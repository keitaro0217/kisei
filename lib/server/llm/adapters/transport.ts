import { safeRequest } from '../../http/safeHttp';
import { classifyHttpError, LlmError, toLlmError } from '../errors';
import type { ProviderRuntime } from '../types';

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function sendJson<T>(
  rt: ProviderRuntime,
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const secrets = [rt.apiKey];
  let res;
  try {
    res = await safeRequest({
      method,
      url,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeoutMs: rt.timeoutMs,
    });
  } catch (e) {
    throw toLlmError(e, secrets);
  }
  if (res.status < 200 || res.status >= 300) {
    throw classifyHttpError(res.status, res.body, secrets, res.headers['retry-after']);
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new LlmError('invalid_response', 'プロバイダーの応答をJSONとして解釈できませんでした。', res.status);
  }
}

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
