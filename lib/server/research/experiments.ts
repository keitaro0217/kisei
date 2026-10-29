import { randomUUID } from 'node:crypto';
import type { Experiment, ExperimentStatus, LlmErrorCategory, MarketConfig } from '@/lib/research/types';
import { errorCategoryLabels } from '@/lib/research/labels';
import { audit } from '../audit';
import type { Principal } from '../auth';
import { LlmError, toLlmError } from '../llm/errors';
import {
  acquireLease,
  emptyTotals,
  getExperimentRecord,
  hasLiveLease,
  insertExperiment,
  listEpisodeIndexes,
  listEpisodes,
  listExperiments as listExperimentRows,
  listExperimentsNeedingWork,
  releaseLease,
  renewLease,
  saveEpisode,
  updateConfig,
  updateExperiment,
} from '../storage/store';
import { getProviderRecord, ValidationError } from './providers';
import { runEpisode } from './sim/episode';
import { runPendingStudyWork } from './study/studies';
import { runPendingEvalWork } from './eval/evaluation';
import { listRunningEvalRuns } from '../storage/evalStore';
import { listStudiesNeedingWork } from '../storage/studyStore';
import { buildSnapshot, versionHashOf } from './snapshot';
import { assertPricedWhenBudgeted, assertWithinBudget } from './usage';

// 実験ジョブ管理。大量エピソードを並列に実行し、進捗をエピソード単位でデータベースに保存する。
// 一時停止・停止・再開に対応し、再開時は保存済みのスナップショット（研究条件）をそのまま使う。
//
// サーバーレス（Vercel）でも動くよう、実行は「スライス」単位で行う。
// - 1回のスライスは時間予算内でエピソードを処理し、残りは次のスライスに引き継ぐ。
// - 実験ごとにリース（担当権）を取り、複数のインスタンスが同じ実験を同時に処理しないようにする。
// - インスタンスが途中で止まってもリースの期限切れ後に別のスライスが続きから再開する。
//   保存前に中断したエピソードは最初からやり直し、二重に保存されることはない。

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

/** リースの有効期間と延長間隔。インスタンスが止まった場合、この時間が過ぎれば別のスライスが引き継ぐ */
const LEASE_MS = 90_000;
const RENEW_MS = 20_000;

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

  const versionLabel = await updateConfig((s) => {
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
    return version.label;
  });
  const exp: Experiment = {
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
    versionLabel,
    completedEpisodes: 0,
    failedEpisodes: 0,
    usage: emptyTotals(),
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    updatedAt: now,
  };
  await insertExperiment(exp);
  await audit(actor, 'experiment.create', exp.id, 'success', `${name}（${episodes}エピソード, ${exp.versionLabel}）`);
  return exp;
}

/** 状態遷移。現在の状態が from に含まれる場合のみ to に変更し、変更できたかを返す */
async function transition(
  id: string,
  from: ExperimentStatus[],
  to: ExperimentStatus,
  reason: string | null = null,
  category: LlmErrorCategory | null = null,
): Promise<boolean> {
  const changed = await updateExperiment(id, (exp) => {
    if (!from.includes(exp.status)) return false;
    exp.status = to;
    exp.statusReason = reason;
    exp.statusCategory = category;
    exp.updatedAt = new Date().toISOString();
    if (['completed', 'stopped', 'failed'].includes(to)) exp.finishedAt = exp.updatedAt;
    return true;
  });
  return changed === true;
}

export type SliceResult = 'done' | 'more' | 'busy';

/**
 * 実験を1スライス分処理する。
 * - done: この実験に今後の処理は不要（完了・一時停止・停止）
 * - more: 時間予算を使い切ったため、続きを次のスライスで処理する
 * - busy: 他のワーカーが処理中
 */
export async function runSlice(id: string, deadline: number): Promise<SliceResult> {
  const owner = randomUUID();
  if (!(await acquireLease(id, owner, LEASE_MS))) return 'busy';
  let leaseLost = false;
  const renewal = setInterval(() => {
    renewLease(id, owner, LEASE_MS)
      .then((ok) => {
        if (!ok) leaseLost = true;
      })
      .catch(() => undefined);
  }, RENEW_MS);
  try {
    const exp = await getExperimentRecord(id);
    if (!exp) return 'done';
    // 前の担当ワーカーが止まった場合、一時停止・停止の要求をここで確定する
    if (exp.status === 'pausing') {
      await transition(id, ['pausing'], 'paused', '利用者が一時停止しました。');
      return 'done';
    }
    if (exp.status === 'stopping') {
      await transition(id, ['stopping'], 'stopped', '利用者が停止しました。');
      return 'done';
    }
    if (exp.status !== 'running') return 'done';

    const snapshot = exp.snapshot;
    const done = new Set(await listEpisodeIndexes(id));
    const pending: number[] = [];
    for (let i = 0; i < exp.episodes; i++) if (!done.has(i)) pending.push(i);

    let consecutiveFailures = 0;
    let pauseReason: { reason: string; category: LlmErrorCategory | null } | null = null;
    // 一時停止・停止の要求は別のインスタンスから届くため、データベースの状態を定期的に確認する
    let statusCheckedAt = 0;
    let latestStatus: ExperimentStatus = exp.status;
    const shouldContinue = async () => {
      if (pauseReason || leaseLost || Date.now() >= deadline) return false;
      if (Date.now() - statusCheckedAt > 1_000) {
        statusCheckedAt = Date.now();
        latestStatus = (await getExperimentRecord(id))?.status ?? 'stopped';
      }
      return latestStatus === 'running';
    };

    const worker = async () => {
      while (await shouldContinue()) {
        const index = pending.shift();
        if (index === undefined) return;
        let attempts = 0;
        for (;;) {
          attempts += 1;
          try {
            const result = await runEpisode({ snapshot, seed: exp.seed + index, index, experimentId: id, judgeEnabled: exp.judgeEnabled });
            await saveEpisode(id, { ...result, status: 'completed', error: null, attempts });
            consecutiveFailures = 0;
            break;
          } catch (e) {
            const err = toLlmError(e);
            if (FATAL.includes(err.category)) {
              // 研究条件を保持したまま一時停止し、このエピソードは再開時に最初からやり直す
              pending.unshift(index);
              pauseReason ??= { reason: `${errorCategoryLabels[err.category]}: ${err.message}`, category: err.category };
              return;
            }
            if (attempts <= snapshot.operational.episodeRetries && Date.now() < deadline && !leaseLost) continue;
            if (attempts <= snapshot.operational.episodeRetries) {
              // 時間切れのため、次のスライスでやり直す
              pending.unshift(index);
              return;
            }
            const now = new Date().toISOString();
            await saveEpisode(id, {
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
            });
            consecutiveFailures += 1;
            if (consecutiveFailures >= snapshot.operational.maxConsecutiveFailures) {
              pauseReason ??= {
                reason: `エピソードが${consecutiveFailures}回連続で失敗したため一時停止しました（${errorCategoryLabels[err.category]}）。`,
                category: err.category,
              };
            }
            break;
          }
        }
      }
    };

    const concurrency = Math.max(1, Math.min(snapshot.operational.episodeConcurrency, pending.length || 1));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (pauseReason) {
      const { reason, category } = pauseReason;
      await transition(id, ['running', 'pausing'], 'paused', reason, category);
      return 'done';
    }
    const status = (await getExperimentRecord(id))?.status;
    if (status === 'pausing') {
      await transition(id, ['pausing'], 'paused', '利用者が一時停止しました。');
      return 'done';
    }
    if (status === 'stopping') {
      await transition(id, ['stopping'], 'stopped', '利用者が停止しました。');
      return 'done';
    }
    if (status !== 'running') return 'done';
    const remaining = exp.episodes - (await listEpisodeIndexes(id)).length;
    if (remaining <= 0) {
      await transition(id, ['running'], 'completed');
      return 'done';
    }
    return 'more';
  } catch (e) {
    const err = toLlmError(e);
    await transition(id, ['running', 'pausing'], 'paused', `内部エラーにより一時停止しました: ${err.message}`, err.category);
    return 'done';
  } finally {
    clearInterval(renewal);
    await releaseLease(id, owner).catch(() => undefined);
  }
}

/**
 * 処理待ちの実験を時間予算内で順に処理する。まだ処理が残っていれば true を返す
 * （呼び出し側が次のスライスを予約する）。
 */
export async function runPendingWork(budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const seen = new Set<string>();
  let more = false;
  while (Date.now() < deadline) {
    const ids = (await listExperimentsNeedingWork(20)).filter((id) => !seen.has(id));
    if (ids.length === 0) break;
    for (const id of ids) {
      seen.add(id);
      if (Date.now() >= deadline) {
        more = true;
        break;
      }
      const result = await runSlice(id, deadline);
      if (result === 'more') more = true;
    }
  }
  if (!more) more = (await listExperimentsNeedingWork(1)).some((id) => !seen.has(id));
  // 多条件の研究（Study）も同じワーカーで処理する
  if (Date.now() < deadline) {
    if (await runPendingStudyWork(deadline)) more = true;
  } else if ((await listStudiesNeedingWork(1)).length > 0) {
    more = true;
  }
  // 評価（LLM Judge など）の実行
  if (Date.now() < deadline) {
    if (await runPendingEvalWork(deadline)) more = true;
  } else if ((await listRunningEvalRuns(1)).length > 0) {
    more = true;
  }
  return more;
}

export async function pauseExperiment(id: string, actor: Principal) {
  const exp = await getExperimentRecord(id);
  if (!exp) throw new ValidationError('実験が見つかりません。');
  if (exp.status !== 'running') throw new ValidationError('実行中の実験のみ一時停止できます。');
  // 処理中のワーカーがいれば、実行中のエピソードの完了を待ってから一時停止する
  const ok = (await hasLiveLease(id))
    ? await transition(id, ['running'], 'pausing', '実行中のエピソードの完了を待っています。')
    : await transition(id, ['running'], 'paused', '利用者が一時停止しました。');
  if (!ok) throw new ValidationError('実験の状態が変わったため一時停止できませんでした。画面を更新してください。');
  await audit(actor, 'experiment.pause', id, 'success');
}

export async function stopExperiment(id: string, actor: Principal) {
  const exp = await getExperimentRecord(id);
  if (!exp) throw new ValidationError('実験が見つかりません。');
  let ok = false;
  if (exp.status === 'paused') {
    ok = await transition(id, ['paused'], 'stopped', '利用者が停止しました。');
  } else if (exp.status === 'running' || exp.status === 'pausing') {
    ok = (await hasLiveLease(id))
      ? await transition(id, ['running', 'pausing'], 'stopping', '実行中のエピソードの完了を待っています。')
      : await transition(id, ['running', 'pausing'], 'stopped', '利用者が停止しました。');
  }
  if (!ok) throw new ValidationError('この実験は停止できません。');
  await audit(actor, 'experiment.stop', id, 'success');
}

export async function resumeExperiment(id: string, actor: Principal) {
  const exp = await getExperimentRecord(id);
  if (!exp) throw new ValidationError('実験が見つかりません。');
  if (exp.status !== 'paused') throw new ValidationError('一時停止中の実験のみ再開できます。');
  try {
    await assertRunnable(exp);
  } catch (e) {
    const err = toLlmError(e);
    await audit(actor, 'experiment.resume', id, 'failure', err.message);
    throw err;
  }
  if (!(await transition(id, ['paused'], 'running'))) throw new ValidationError('実験の状態が変わったため再開できませんでした。');
  await audit(actor, 'experiment.resume', id, 'success');
}

export async function listExperiments(): Promise<Experiment[]> {
  return listExperimentRows();
}

export async function getExperiment(id: string, limit = 200) {
  const experiment = await getExperimentRecord(id);
  if (!experiment) return null;
  const { episodes, total } = await listEpisodes(id, limit);
  return { experiment, episodes, episodeCount: total };
}

/** テスト・ローカル実行用: 実験の処理が終わる（完了・一時停止・停止）まで同じプロセスで処理する */
export async function waitForJob(id: string) {
  for (;;) {
    const result = await runSlice(id, Date.now() + 60_000);
    if (result === 'done') {
      const exp = await getExperimentRecord(id);
      if (!exp || !['running', 'pausing', 'stopping'].includes(exp.status)) return;
    } else if (result === 'busy') {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}
