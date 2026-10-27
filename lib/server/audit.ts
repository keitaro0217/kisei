import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '@/lib/research/types';
import type { Principal } from './auth';
import { safeMessage } from './security/redact';
import { appendJsonl, readJsonl } from './storage/store';

// 監査ログ。APIキー・パスワード・Authorization ヘッダーは記録しない（detail も redact する）。

export async function audit(
  actor: Principal | string,
  action: string,
  target: string | null,
  result: AuditEntry['result'],
  detail?: string | null,
): Promise<void> {
  const entry: AuditEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: typeof actor === 'string' ? actor : actor.id,
    action,
    target,
    result,
    detail: detail ? safeMessage(detail) : null,
  };
  try {
    await appendJsonl('audit.jsonl', entry);
  } catch {
    console.error('[audit] 監査ログを書き込めませんでした');
  }
}

export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  const all = await readJsonl<AuditEntry>('audit.jsonl');
  return all.slice(-limit).reverse();
}
