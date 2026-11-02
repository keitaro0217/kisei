import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, startMockLlm, type MockLlm } from './helpers';

// 研究の運用: 複製・費用の事前見積もり・費用の上限での一時停止・上限の変更と再開・処理の停止の検知。

let mock: MockLlm;
const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'session' as const };

beforeAll(async () => {
  await setupEnv();
  mock = await startMockLlm();
  process.env.LLM_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${mock.port}`;
  mock.setHandler((req) => {
    if (req.url.endsWith('/models')) return { status: 200, body: { data: [{ id: 'mock-model' }] } };
    const content = JSON.stringify({ action: 'hold', rationale: '様子を見る', cited_rules: [], self_assessed_compliance: 'compliant' });
    return { status: 200, body: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } } };
  });
});
afterAll(async () => {
  await mock.close();
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

async function modelProvider() {
  const { createProvider, setApiKey } = await import('@/lib/server/research/providers');
  const { updateConfig } = await import('@/lib/server/storage/store');
  const p = await createProvider({ type: 'openai_compatible', name: 'Mock', baseUrl: mock.url, defaultModel: 'mock-model' });
  await setApiKey(p.id, 'sk-test-valid-key-1234');
  // 単価: 入力 $1 / 出力 $10（100万トークンあたり）→ 1回 = 1000 × 1 + 100 × 10 = 2000 / 1e6 = $0.002
  await updateConfig((s) => {
    s.prices.push({ providerId: p.id, model: 'mock-model', inputPerMTok: 1, outputPerMTok: 10, cachedInputPerMTok: null, cacheWritePerMTok: null, source: 'テスト用の単価', updatedAt: new Date().toISOString() });
  });
  return p;
}

describe('研究の運用', () => {
  it('複製は研究デザインだけを新しい下書きにし、複製元を記録する', async () => {
    const { createStudy, startStudy, waitForStudy } = await import('@/lib/server/research/study/studies');
    const { duplicateStudy } = await import('@/lib/server/research/study/operations');
    const s = await createStudy({ title: '元の研究', conditions: [{ id: 'A', label: 'A' }], replicates: 2, market: { steps: 2 }, agent: { kind: 'mock' } }, actor);
    await startStudy(s.id, actor);
    await waitForStudy(s.id);
    const copy = await duplicateStudy(s.id, actor);
    expect(copy.status).toBe('draft');
    expect(copy.frozen).toBeNull();
    expect(copy.duplicatedFrom).toBe(s.id);
    expect(copy.design.title).toBe('元の研究（複製）');
    expect(copy.design.replicates).toBe(2);
  });

  it('費用を事前に見積もり、上限に達すると一時停止し、上限を上げると再開できる', async () => {
    const p = await modelProvider();
    const { createStudy, startStudy, waitForStudy, resumeStudy } = await import('@/lib/server/research/study/studies');
    const { estimateStudy, updateStudyBudget, studyLiveness } = await import('@/lib/server/research/study/operations');
    const { getStudy } = await import('@/lib/server/storage/studyStore');
    const s = await createStudy(
      { title: '費用', conditions: [{ id: 'A', label: 'A' }], replicates: 4, market: { steps: 5 }, agent: { kind: 'model', providerId: p.id, model: 'mock-model' }, maxCostUsd: 0.015 },
      actor,
    );
    const est = await estimateStudy(s.id);
    expect(est.calls).toBe(20);
    expect(est.tokensPerCall.basis).toBe('assumed');
    expect(est.price?.inputPerMTok).toBe(1);
    expect(est.estimatedUsd).not.toBeNull();
    expect(est.maxCostUsd).toBe(0.015);
    await startStudy(s.id, actor);
    await waitForStudy(s.id);
    // 1セッション = 5回 × $0.002 = $0.01 → 2セッション目の終了後に上限を超えるため、3セッション目は開始しない
    const paused = await getStudy(s.id);
    expect(paused!.status).toBe('paused');
    expect(paused!.statusReason).toMatch(/費用の上限/);
    const after = await estimateStudy(s.id);
    expect(after.spentUsd).toBeGreaterThanOrEqual(0.015);
    expect(after.calls).toBeLessThan(20);
    // 実績ができたので、1回あたりのトークン数は実績から見積もる
    expect(after.tokensPerCall).toMatchObject({ input: 1000, output: 100, basis: 'observed' });
    expect((await studyLiveness(s.id)).state).not.toBe('active');
    await updateStudyBudget(s.id, 1, actor);
    await resumeStudy(s.id, actor);
    await waitForStudy(s.id);
    expect((await getStudy(s.id))!.status).toBe('completed');
    expect((await studyLiveness(s.id)).state).toBe('idle');
    await expect(updateStudyBudget(s.id, 2, actor)).rejects.toThrow(/終了した研究/);
  });

  it('リースが切れたまま一定時間進んでいないセッションを「停止」と判定する', async () => {
    const { createStudy, startStudy } = await import('@/lib/server/research/study/studies');
    const { studyLiveness } = await import('@/lib/server/research/study/operations');
    const { getDb } = await import('@/lib/server/db');
    const s = await createStudy({ title: '停止', conditions: [{ id: 'A', label: 'A' }], replicates: 2, market: { steps: 2 }, agent: { kind: 'mock' } }, actor);
    await startStudy(s.id, actor);
    expect((await studyLiveness(s.id)).state).toBe('waiting');
    const db = await getDb();
    // ワーカーが処理中に止まった状態（リース切れ・最終更新が 1 時間前）
    await db.query(
      `UPDATE rc_study_sessions SET status = 'running', lease_owner = 'dead', lease_until = now() - interval '1 minute',
              data = data || jsonb_build_object('startedAt', (now() - interval '1 hour')::text) WHERE study_id = $1`,
      [s.id],
    );
    const l = await studyLiveness(s.id);
    expect(l.state).toBe('stalled');
    expect(l.remaining).toBe(2);
    await db.query(`UPDATE rc_study_sessions SET lease_until = now() + interval '1 minute' WHERE study_id = $1`, [s.id]);
    expect((await studyLiveness(s.id)).state).toBe('active');
  });
});
