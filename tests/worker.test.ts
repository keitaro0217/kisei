import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, startMockLlm, type MockLlm } from './helpers';

// サーバーレス（Vercel）を想定した実験ワーカーの動作確認。
// 関数の実行時間切れ・インスタンスの停止・別インスタンスからの操作を、データベースの状態だけで引き継げることを確かめる。

let mock: MockLlm;
const actor = { id: 'basic:researcher', displayName: 'researcher', tenantId: 'default', permissions: [], authMethod: 'basic' as const };

beforeAll(async () => {
  await setupEnv();
  mock = await startMockLlm();
  process.env.LLM_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${mock.port}`;
  const { createProvider, setApiKey } = await import('@/lib/server/research/providers');
  const { updateRole } = await import('@/lib/server/research/settings');
  const p = await createProvider({ type: 'openai_compatible', name: 'Mock', baseUrl: mock.url, defaultModel: 'mock-model' });
  await setApiKey(p.id, 'sk-test-valid-key-1234');
  await updateRole('trading_agent', { providerId: p.id, model: 'mock-model', maxOutputTokens: 256 });
});
afterAll(async () => {
  await mock.close();
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

async function setSlowResponses(ms: number) {
  mock.setDelay(ms);
  return () => mock.setDelay(0);
}

describe('実験ワーカー（スライス実行）', () => {
  it('時間予算を使い切ったら続きを次のスライスに引き継ぎ、全エピソードを重複なく処理する', async () => {
    const { createExperiment, runSlice, getExperiment } = await import('@/lib/server/research/experiments');
    const exp = await createExperiment({ name: 'slices', episodes: 30, steps: 1, seed: 3 }, actor);
    const restore = await setSlowResponses(15);
    let slices = 0;
    let result: string;
    do {
      result = await runSlice(exp.id, Date.now() + 60);
      slices += 1;
    } while (result !== 'done' && slices < 200);
    restore();
    expect(slices).toBeGreaterThan(1);
    const data = (await getExperiment(exp.id, 1000))!;
    expect(data.experiment.status).toBe('completed');
    expect(data.experiment.completedEpisodes).toBe(30);
    expect(data.episodeCount).toBe(30);
    expect(new Set(data.episodes.map((e) => e.index)).size).toBe(30);
    expect(data.experiment.usage.calls).toBe(30);
  });

  it('同じ実験を複数のワーカーが同時に処理しない（リース）', async () => {
    const { createExperiment, runSlice, getExperiment } = await import('@/lib/server/research/experiments');
    const exp = await createExperiment({ name: 'lease', episodes: 8, steps: 1, seed: 4 }, actor);
    const restore = await setSlowResponses(5);
    const results = await Promise.all([runSlice(exp.id, Date.now() + 30_000), runSlice(exp.id, Date.now() + 30_000)]);
    restore();
    expect(results.sort()).toEqual(['busy', 'done']);
    const data = (await getExperiment(exp.id))!;
    expect(data.experiment.completedEpisodes).toBe(8);
    expect(data.experiment.usage.calls).toBe(8);
  });

  it('ワーカーが途中で止まっても、リースの期限切れ後に別のワーカーが続きから再開する', async () => {
    const { createExperiment, runSlice, getExperiment } = await import('@/lib/server/research/experiments');
    const { acquireLease } = await import('@/lib/server/storage/store');
    const exp = await createExperiment({ name: 'crash', episodes: 5, steps: 1, seed: 5 }, actor);
    // 停止したインスタンスが残したリース（有効期限 300ms）
    expect(await acquireLease(exp.id, 'dead-instance', 300)).toBe(true);
    expect(await runSlice(exp.id, Date.now() + 30_000)).toBe('busy');
    await new Promise((r) => setTimeout(r, 400));
    expect(await runSlice(exp.id, Date.now() + 30_000)).toBe('done');
    expect((await getExperiment(exp.id))!.experiment.status).toBe('completed');
  });

  it('別のインスタンスからの一時停止要求を処理中のワーカーが検知し、研究条件を保ったまま停止する', async () => {
    const { createExperiment, runSlice, getExperiment, pauseExperiment, resumeExperiment, waitForJob } = await import(
      '@/lib/server/research/experiments'
    );
    const exp = await createExperiment({ name: 'pause', episodes: 60, steps: 1, seed: 6 }, actor);
    const restore = await setSlowResponses(150);
    const slice = runSlice(exp.id, Date.now() + 60_000);
    await new Promise((r) => setTimeout(r, 300));
    await pauseExperiment(exp.id, actor);
    expect((await getExperiment(exp.id))!.experiment.status).toBe('pausing');
    expect(await slice).toBe('done');
    restore();
    let data = (await getExperiment(exp.id, 1000))!;
    expect(data.experiment.status).toBe('paused');
    expect(data.experiment.completedEpisodes).toBeLessThan(60);

    await resumeExperiment(exp.id, actor);
    await waitForJob(exp.id);
    data = (await getExperiment(exp.id, 1000))!;
    expect(data.experiment.status).toBe('completed');
    expect(new Set(data.episodes.map((e) => e.index)).size).toBe(60);
  });

  it('停止した担当ワーカーが残した「一時停止中」は、次のスライスで一時停止に確定する', async () => {
    const { createExperiment, runSlice, getExperiment, pauseExperiment } = await import('@/lib/server/research/experiments');
    const { acquireLease } = await import('@/lib/server/storage/store');
    const exp = await createExperiment({ name: 'pausing-orphan', episodes: 5, steps: 1, seed: 7 }, actor);
    await acquireLease(exp.id, 'dead-instance', 200);
    await pauseExperiment(exp.id, actor);
    expect((await getExperiment(exp.id))!.experiment.status).toBe('pausing');
    await new Promise((r) => setTimeout(r, 300));
    expect(await runSlice(exp.id, Date.now() + 30_000)).toBe('done');
    expect((await getExperiment(exp.id))!.experiment.status).toBe('paused');
  });

  it('処理待ちの実験をまとめて処理し、残りがあれば継続が必要と返す', async () => {
    const { createExperiment, runPendingWork, getExperiment } = await import('@/lib/server/research/experiments');
    const a = await createExperiment({ name: 'drain-a', episodes: 3, steps: 1, seed: 8 }, actor);
    const b = await createExperiment({ name: 'drain-b', episodes: 3, steps: 1, seed: 9 }, actor);
    let more = true;
    for (let i = 0; i < 20 && more; i++) more = await runPendingWork(10_000);
    expect(more).toBe(false);
    expect((await getExperiment(a.id))!.experiment.status).toBe('completed');
    expect((await getExperiment(b.id))!.experiment.status).toBe('completed');
  });
});
