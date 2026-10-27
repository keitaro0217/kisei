import type { ReasoningSettings, RoleSnapshot, UsageRecord } from '@/lib/research/types';
import { getProviderRecord, runtimeFor } from '../research/providers';
import { assertWithinBudget, recordUsage } from '../research/usage';
import { getAdapter } from './adapters';
import { LlmError, toLlmError } from './errors';
import type { ChatOutput } from './types';

// すべてのLLM呼び出しはこの関数を経由する（バックエンド経由での実行を強制）。
// 予算確認・同時実行数の制御・再試行・使用量記録を一元的に行う。

type Semaphore = { limit: number; active: number; waiters: (() => void)[] };
const g = globalThis as typeof globalThis & { __llmSemaphores?: Map<string, Semaphore> };
const semaphores: Map<string, Semaphore> = (g.__llmSemaphores ??= new Map());

async function acquire(key: string, limit: number): Promise<() => void> {
  let sem = semaphores.get(key);
  if (!sem) {
    sem = { limit, active: 0, waiters: [] };
    semaphores.set(key, sem);
  }
  sem.limit = limit;
  const s = sem;
  if (s.active >= s.limit) await new Promise<void>((resolve) => s.waiters.push(resolve));
  s.active += 1;
  return () => {
    s.active -= 1;
    const next = s.waiters.shift();
    if (next) next();
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type InvokeInput = {
  providerId: string;
  model: string;
  reasoning: ReasoningSettings;
  maxOutputTokens: number;
  system: string;
  user: string;
  purpose: UsageRecord['role'];
  experimentId?: string | null;
  episodeIndex?: number | null;
  /** 実験から呼ぶ場合、開始時点のスナップショットと接続先が一致することを確認する */
  snapshot?: RoleSnapshot;
  /** 実験開始時に固定した運用設定（未指定ならプロバイダーの現在値） */
  timeoutMs?: number;
  maxRetries?: number;
};

export type InvokeResult = ChatOutput & { record: UsageRecord; attempts: number; latencyMs: number };

export async function invokeModel(input: InvokeInput): Promise<InvokeResult> {
  const record = await getProviderRecord(input.providerId);
  if (!record) throw new LlmError('not_configured', 'プロバイダーが登録されていません（削除された可能性があります）。');
  if (input.snapshot && (record.type !== input.snapshot.providerType || record.baseUrl !== input.snapshot.baseUrl)) {
    throw new LlmError('provider_changed', '実験開始時からプロバイダーの種類または接続先が変更されたため実行を中止しました。');
  }
  const rt = runtimeFor(record);
  if (input.timeoutMs) rt.timeoutMs = input.timeoutMs;
  const maxRetries = input.maxRetries ?? record.maxRetries;
  const adapter = getAdapter(record.type);

  const release = await acquire(record.id, record.maxConcurrency);
  const started = Date.now();
  try {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      await assertWithinBudget(record.id);
      try {
        const out = await adapter.chat(rt, {
          model: input.model,
          system: input.system,
          user: input.user,
          maxOutputTokens: input.maxOutputTokens,
          reasoning: input.reasoning,
        });
        const usageRecord = await recordUsage({
          providerId: record.id,
          providerType: record.type,
          model: input.model,
          role: input.purpose,
          experimentId: input.experimentId ?? null,
          episodeIndex: input.episodeIndex ?? null,
          usage: out.usage,
          ok: true,
          errorCategory: null,
        });
        return { ...out, record: usageRecord, attempts: attempt, latencyMs: Date.now() - started };
      } catch (e) {
        const err = toLlmError(e, [rt.apiKey]);
        await recordUsage({
          providerId: record.id,
          providerType: record.type,
          model: input.model,
          role: input.purpose,
          experimentId: input.experimentId ?? null,
          episodeIndex: input.episodeIndex ?? null,
          usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: null },
          ok: false,
          errorCategory: err.category,
        });
        if (!err.retryable || attempt > maxRetries) throw err;
        const backoff = err.retryAfterMs ?? Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        await sleep(Math.min(backoff, 60_000));
      }
    }
  } finally {
    release();
  }
}
