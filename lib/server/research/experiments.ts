import { randomUUID } from 'node:crypto';
import type { EpisodeResult, Experiment, ExperimentStatus, LlmErrorCategory, MarketConfig } from '@/lib/research/types';
import { errorCategoryLabels } from '@/lib/research/labels';
import { audit } from '../audit';
import type { Principal } from '../auth';
import { LlmError, toLlmError } from '../llm/errors';
import { appendJsonl, emptyTotals, getState, readJsonl, updateState } from '../storage/store';
import { getProviderRecord, ValidationError } from './providers';
import { runEpisode } from './sim/episode';
import { buildSnapshot, versionHashOf } from './snapshot';
import { assertPricedWhenBudgeted, assertWithinBudget } from './usage';

// 実験ジョブ管理。大量エピソードを並列に実行し、進捗をエピソード単位で永続化する。
// 一時停止・停止・再開に対応し、再開時は保存済みのスナップショット（研究条件）をそのまま使う。

/** 実験全体を一時停止すべきエラー（設定・認証・予算など。再試行しても解消しない） */
const FATAL: LlmErrorCategory[] = [
  'not_configured',
  'auth',
  'permission',
  'model_unavailable',
  'quota',
  'budget_exceeded',
  'provider_changed',
  'ssrf_blocked',
  'invalid_request',
];

type Control = { desired: 'run' | 'pause' | 'stop'; reason: string | null; category: LlmErrorCategory | null; promise: Promise<void> | null };
const g = globalThis as typeof globalThis & { __experimentJobs?: Map<string, Control> };
const jobs: Map<string, Control> = (g.__experimentJobs ??= new Map());

const episodesFile = (id: string) => `episodes/${id}.jsonl`;

export type CreateExperimentInput = {
  name?: unknown;
  description?: unknown;
  episodes?: unknown;
  steps?: unknown;
  seed?: unknown;
  judgeEnabled?: unknown;
  initialCash?: unknown;
  maxOrderQuantity?: unknown;
  maxPosition?: unknown;
  allowShortSelling?: unknown;
};

function int(value: unknown, label: string, min: number, max: number, fallback?: number): number {
  if ((value === undefined || value === '') && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label}は${min}〜${max}の整数で入力してください。`);
  return n;
}

export function parseMarketConfig(input: CreateExperimentInput): MarketConfig {
  return {
    steps: int(input.steps, 'ステップ数', 1, 50, 5),
    initialCash: int(input.initialCash, '初期資金', 1_000, 100_000_000, 100_000),
    initialPrice: 1_000,
    volatility: 0.02,
    rules: {
      maxOrderQuantity: int(input.maxOrderQuantity, '注文数量の上限', 1, 100_000, 100),
      maxPosition: int(input.maxPosition, '保有上限', 1, 1_000_000, 500),
      allowShortSelling: input.allowShortSelling === true,
    },
  };
}

async function assertRunnable(exp: Pick<Experiment, 'snapshot' | 'judgeEnabled'>) {
  const roles = [exp.snapshot.roles.trading_agent, exp.judgeEnabled ? exp.snapshot.roles.llm_judge : null].filter(Boolean);
  for (const role of roles) {
    const record = await getProviderRecord(role!.providerId);
    if (!record) throw new LlmError('not_configured', `プロバイダー「${role!.providerName}」が削除されています。`);
    if (record.type !== role!.providerType || record.baseUrl !== role!.baseUrl) {
      throw new LlmError('provider_changed', `プロバイダー「${role!.providerName}」の接続先が実験開始時から変更されています。新しい実験として開始してください。`);
    }
    await assertPricedWhenBudgeted(role!.providerId, role!.model);
    await assertWithinBudget(role!.providerId);
  }
}

export async function createExperiment(input: CreateExperimentInput, actor: Principal): Promise<Experiment> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new ValidationError('実験名は1〜100文字で入力してください。');
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '';
  const episodes = int(input.episodes, 'エピソード数', 1, 100_000, 10);
  const seed = int(input.seed, '乱数シード', 0, 2 ** 31 - 1, Math.floor(Math.random() * 1_000_000));
  const judgeEnabled = input.judgeEnabled === true;
  const market = parseMarketConfig(input);

  const snapshot = await buildSnapshot(market, judgeEnabled);
  await assertRunnable({ snapshot, judgeEnabled });
  const versionHash = versionHashOf(snapshot);
  const now = new Date().toISOString();

  const exp = await updateState((s) => {
    let version = s.experimentVersions.find((v) => v.hash === versionHash);
    if (!version) {
      version = {
        hash: versionHash,
        label: `v${s.experimentVersions.length + 1}`,
        createdAt: now,
        summary: `${snapshot.roles.trading_agent.providerName} / ${snapshot.roles.trading_agent.model}${
          snapshot.roles.llm_judge ? ` ・ Judge: ${snapshot.roles.llm_judge.model}` : ''
        } ・ ${snapshot.prompts.promptVersion}`,
      };
      s.experimentVersions.push(version);
    }
    const created: Experiment = {
      id: randomUUID(),
      name,
      description,
      status: 'running',
      statusReason: null,
      statusCategory: null,
      episodes,
      seed,
      judgeEnabled,
      snapshot,
      versionHash,
      versionLabel: version.label,
      completedEpisodes: 0,
      failedEpisodes: 0,
      usage: emptyTotals(),
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    };
    s.experiments.unshift(created);
    return created;
  });
  await audit(actor, 'experiment.create', exp.id, 'success', `${name}（${episodes}エピソード, ${exp.versionLabel}）`);
  launch(exp.id);
  return exp;
}

async function setStatus(id: string, status: ExperimentStatus, reason: string | null = null, category: LlmErrorCategory | null = null) {
  await updateState((s) => {
    const exp = s.experiments.find((e) => e.id === id);
    if (!exp) return;
    exp.status = status;
    exp.statusReason = reason;
    exp.statusCategory = category;
    exp.updatedAt = new Date().toISOString();
    if (['completed', 'stopped', 'failed'].includes(status)) exp.finishedAt = exp.updatedAt;
  });
}

function launch(id: string) {
  const control: Control = { desired: 'run', reason: null, category: null, promise: null };
  jobs.set(id, control);
  control.promise = runJob(id, control)
    .catch(async (e) => {
      const err = toLlmError(e);
      await setStatus(id, 'paused', `内部エラーにより一時停止しました: ${err.message}`, err.category);
    })
    .finally(() => {
      if (jobs.get(id) === control) jobs.delete(id);
    });
}

async function runJob(id: string, control: Control) {
  const state = await getState();
  const exp = state.experiments.find((e) => e.id === id);
  if (!exp) return;
  const snapshot = exp.snapshot;
  const done = new Set((await readJsonl<EpisodeResult>(episodesFile(id))).map((r) => r.index));
  const pending: number[] = [];
  for (let i = 0; i < exp.episodes; i++) if (!done.has(i)) pending.push(i);

  let consecutiveFailures = 0;
  const pause = (reason: string, category: LlmErrorCategory | null) => {
    if (control.desired === 'run') {
      control.desired = 'pause';
      control.reason = reason;
      control.category = category;
    }
  };

  const worker = async () => {
    while (control.desired === 'run') {
      const index = pending.shift();
      if (index === undefined) return;
      let attempts = 0;
      for (;;) {
        attempts += 1;
        try {
          const result = await runEpisode({ snapshot, seed: exp.seed + index, index, experimentId: id, judgeEnabled: exp.judgeEnabled });
          await appendJsonl(episodesFile(id), { ...result, status: 'completed', error: null, attempts } satisfies EpisodeResult);
          await updateState((s) => {
            const e = s.experiments.find((x) => x.id === id);
            if (e) {
              e.completedEpisodes += 1;
              e.updatedAt = new Date().toISOString();
            }
          });
          consecutiveFailures = 0;
          break;
        } catch (e) {
          const err = toLlmError(e);
          if (FATAL.includes(err.category)) {
            // 研究条件を保持したまま一時停止し、このエピソードは再開時に最初からやり直す
            pending.unshift(index);
            pause(`${errorCategoryLabels[err.category]}: ${err.message}`, err.category);
            return;
          }
          if (control.desired !== 'run') {
            pending.unshift(index);
            return;
          }
          if (attempts <= snapshot.operational.episodeRetries) continue;
          const now = new Date().toISOString();
          await appendJsonl(episodesFile(id), {
            index,
            seed: exp.seed + index,
            status: 'failed',
            error: { category: err.category, message: err.message },
            finalValue: null,
            pnl: null,
            violationCount: 0,
            decisions: [],
            judge: null,
            usage: emptyTotals(),
            attempts,
            startedAt: now,
            finishedAt: now,
          } satisfies EpisodeResult);
          await updateState((s) => {
            const x = s.experiments.find((y) => y.id === id);
            if (x) {
              x.failedEpisodes += 1;
              x.updatedAt = now;
            }
          });
          consecutiveFailures += 1;
          if (consecutiveFailures >= snapshot.operational.maxConsecutiveFailures) {
            pause(`エピソードが${consecutiveFailures}回連続で失敗したため一時停止しました（${errorCategoryLabels[err.category]}）。`, err.category);
          }
          break;
        }
      }
    }
  };

  const concurrency = Math.max(1, Math.min(snapshot.operational.episodeConcurrency, pending.length || 1));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (pending.length === 0 && control.desired !== 'stop') await setStatus(id, 'completed');
  else if (control.desired === 'stop') await setStatus(id, 'stopped', '利用者が停止しました。');
  else if (control.desired === 'pause') await setStatus(id, 'paused', control.reason ?? '利用者が一時停止しました。', control.category);
  else await setStatus(id, 'completed');
}

export async function pauseExperiment(id: string, actor: Principal) {
  const control = jobs.get(id);
  const exp = (await getState()).experiments.find((e) => e.id === id);
  if (!exp) throw new ValidationError('実験が見つかりません。');
  if (!control || exp.status !== 'running') throw new ValidationError('実行中の実験のみ一時停止できます。');
  control.desired = 'pause';
  control.reason = '利用者が一時停止しました。';
  await setStatus(id, 'pausing', '実行中のエピソードの完了を待っています。');
  await audit(actor, 'experiment.pause', id, 'success');
}

export async function stopExperiment(id: string, actor: Principal) {
  const exp = (await getState()).experiments.find((e) => e.id === id);
  if (!exp) throw new ValidationError('実験が見つかりません。');
  const control = jobs.get(id);
  if (control) {
    control.desired = 'stop';
    await setStatus(id, 'stopping', '実行中のエピソードの完了を待っています。');
  } else if (exp.status === 'paused') {
    await setStatus(id, 'stopped', '利用者が停止しました。');
  } else {
    throw new ValidationError('この実験は停止できません。');
  }
  await audit(actor, 'experiment.stop', id, 'success');
}

export async function resumeExperiment(id: string, actor: Principal) {
  const exp = (await getState()).experiments.find((e) => e.id === id);
  if (!exp) throw new ValidationError('実験が見つかりません。');
  if (exp.status !== 'paused' || jobs.has(id)) throw new ValidationError('一時停止中の実験のみ再開できます。');
  try {
    await assertRunnable(exp);
  } catch (e) {
    const err = toLlmError(e);
    await audit(actor, 'experiment.resume', id, 'failure', err.message);
    throw err;
  }
  await setStatus(id, 'running');
  await audit(actor, 'experiment.resume', id, 'success');
  launch(id);
}

export async function listExperiments(): Promise<Experiment[]> {
  return (await getState()).experiments;
}

export async function getExperiment(id: string) {
  const state = await getState();
  const exp = state.experiments.find((e) => e.id === id);
  if (!exp) return null;
  const episodes = await readJsonl<EpisodeResult>(episodesFile(id));
  return { experiment: exp, episodes };
}

/** テスト用: 実行中ジョブの完了を待つ */
export async function waitForJob(id: string) {
  await jobs.get(id)?.promise;
}
