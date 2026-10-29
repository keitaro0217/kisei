import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, startMockLlm, type MockLlm } from './helpers';

// 実行トレース: 親子関係・時系列・重複のない ID・本文の伏せ字・エラーの記録・検索・エクスポート。

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'basic' as const };
let mock: MockLlm;

beforeAll(async () => {
  await setupEnv();
  mock = await startMockLlm();
  process.env.LLM_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${mock.port}`;
});
afterAll(async () => {
  await mock.close();
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

async function runMockStudy(steps = 6, replicates = 2) {
  const { createPairFromTemplate } = await import('@/lib/server/research/study/rules');
  const { createStudy, startStudy, waitForStudy } = await import('@/lib/server/research/study/studies');
  const { ruleA, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
  const study = await createStudy(
    { title: 'trace', conditions: [{ id: 'A', label: 'A', ruleVersionIds: [ruleA.id] }, { id: 'B', label: 'B', ruleVersionIds: [ruleB.id] }], replicates, market: { steps } },
    actor,
  );
  await startStudy(study.id, actor);
  await waitForStudy(study.id);
  return study.id;
}

describe('実行トレース', () => {
  it('セッションごとに Span のツリーを記録し、親子関係・時系列・ID の一意性が正しい', async () => {
    const studyId = await runMockStudy();
    const { listTraces, getTrace } = await import('@/lib/server/storage/traceStore');
    const list = await listTraces({ studyId });
    expect(list).toHaveLength(4);
    const t = (await getTrace(list[0].traceId))!;
    expect(t.traceId).toMatch(/^[0-9a-f]{32}$/);
    const ids = new Set(t.spans.map((s) => s.spanId));
    expect(ids.size).toBe(t.spans.length);
    const roots = t.spans.filter((s) => s.parentSpanId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0].kind).toBe('episode');
    for (const s of t.spans) {
      if (s.parentSpanId) expect(ids.has(s.parentSpanId)).toBe(true);
      expect(s.endedAt).not.toBeNull();
      expect(Date.parse(s.endedAt!)).toBeGreaterThanOrEqual(Date.parse(s.startedAt));
    }
    const steps = t.spans.filter((s) => s.kind === 'step');
    expect(steps.map((s) => s.attributes.step)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const step of steps) {
      const kinds = t.spans.filter((s) => s.parentSpanId === step.spanId).map((s) => s.kind);
      expect(kinds).toEqual(['market.observe', 'retrieval', 'llm', 'order', 'evaluation.formal', 'evaluation.intent']);
    }
    // 子の Span は親の開始以降に始まる
    for (const s of t.spans) {
      const parent = t.spans.find((p) => p.spanId === s.parentSpanId);
      if (parent) expect(Date.parse(s.startedAt)).toBeGreaterThanOrEqual(Date.parse(parent.startedAt));
    }
    expect(roots[0].attributes.rules).toEqual(expect.arrayContaining([expect.stringMatching(/^SPOOF-(AND|OR)@v\d+$/)]));
    // 既定の記録モードは「伏せ字」で、モックの出力本文が残る
    expect(t.payloadMode).toBe('redacted');
    expect(t.spans.find((s) => s.kind === 'llm')!.output).toContain('モック');
  });

  it('検索条件（条件・反復・違反・エラー）で絞り込める', async () => {
    const studyId = await runMockStudy(10, 3);
    const { listTraces } = await import('@/lib/server/storage/traceStore');
    const { listDecisions } = await import('@/lib/server/storage/studyStore');
    expect((await listTraces({ studyId, conditionId: 'B' })).every((t) => t.conditionId === 'B')).toBe(true);
    expect(await listTraces({ studyId, conditionId: 'A', replicate: 1 })).toHaveLength(1);
    const decisions = await listDecisions(studyId);
    const withViolation = new Set(decisions.filter((d) => d.enforcement.violations.some((v) => v.ruleKey)).map((d) => `${d.conditionId}/${d.replicate}`));
    const flagged = await listTraces({ studyId, hasViolation: true });
    expect(new Set(flagged.map((t) => `${t.conditionId}/${t.replicate}`))).toEqual(withViolation);
    expect(await listTraces({ studyId, status: 'ERROR' })).toHaveLength(0);
  });

  it('本文の記録モード: metadata は本文を保存せず、redacted は秘密情報・個人情報を伏せる', async () => {
    const { maskPayload, Tracer, toOtlp } = await import('@/lib/server/research/trace/tracer');
    const secret = 'sk-test-abcdefghijklmnop プロンプト user@example.com 口座 1234567890123 Authorization: Bearer abcdefghijkl';
    expect(maskPayload(secret, 'metadata')).toBeUndefined();
    const red = maskPayload(secret, 'redacted')!;
    expect(red).not.toContain('sk-test-abcdefghijklmnop');
    expect(red).not.toContain('user@example.com');
    expect(red).not.toContain('1234567890123');
    expect(red).not.toContain('abcdefghijkl');
    expect(red).toContain('プロンプト');
    expect(maskPayload('x'.repeat(10_000), 'full')!.length).toBeLessThan(4100);
    // OpenTelemetry 形式への変換
    const tr = new Tracer({ studyId: 's', conditionId: 'A', replicate: 0 }, 'metadata');
    const root = tr.start('root', 'episode', null, { n: 1 });
    const child = tr.start('child', 'llm', root);
    tr.end(child, { input: 'secret prompt', error: { type: 'timeout', message: 'timed out sk-test-abcdefghijk' } });
    tr.end(root);
    const rec = tr.record();
    expect(rec.status).toBe('ERROR');
    expect(rec.spans[1].input).toBeUndefined();
    expect(rec.spans[1].error!.message).not.toContain('sk-test-abcdefghijk');
    const otlp = toOtlp(rec);
    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);
    expect(spans[1].status.code).toBe(2);
    expect(spans[0].startTimeUnixNano).toMatch(/^\d{19}$/);
  });

  it('モデル呼び出しが失敗したセッションも、エラーの Span を含むトレースを残す', async () => {
    const { createProvider, setApiKey } = await import('@/lib/server/research/providers');
    const { updateRole } = await import('@/lib/server/research/settings');
    const p = await createProvider({ type: 'openai_compatible', name: 'Mock', baseUrl: mock.url, defaultModel: 'mock-model' });
    await setApiKey(p.id, 'sk-test-valid-key-1234');
    await updateRole('trading_agent', { providerId: p.id, model: 'mock-model', maxOutputTokens: 256 });
    mock.setHandler(() => ({ status: 400, body: { error: { message: 'bad request from provider' } } }));
    const { createStudy, startStudy, waitForStudy, getStudyDetail } = await import('@/lib/server/research/study/studies');
    const study = await createStudy({ title: 'err', conditions: [{ id: 'A', label: 'A' }], replicates: 1, market: { steps: 2 }, agent: { kind: 'model' } }, actor);
    await startStudy(study.id, actor);
    await waitForStudy(study.id);
    expect((await getStudyDetail(study.id))!.study.status).toBe('paused');
    const { listTraces, getTrace } = await import('@/lib/server/storage/traceStore');
    const [summary] = await listTraces({ studyId: study.id, status: 'ERROR' });
    const t = (await getTrace(summary.traceId))!;
    const failed = t.spans.find((s) => s.kind === 'llm' && s.status === 'ERROR')!;
    expect(failed.error!.type).toBe('invalid_request');
    expect(JSON.stringify(t)).not.toContain('sk-test-valid-key-1234');
  });

  it('保存期間を過ぎたトレースは削除される', async () => {
    const { purgeTracesOlderThan, listTraces } = await import('@/lib/server/storage/traceStore');
    const { getDb } = await import('@/lib/server/db');
    const before = (await listTraces({ limit: 500 })).length;
    expect(before).toBeGreaterThan(0);
    const db = await getDb();
    await db.query(`UPDATE rc_traces SET started_at = now() - interval '100 days' WHERE trace_id = (SELECT trace_id FROM rc_traces LIMIT 1)`);
    expect(await purgeTracesOlderThan(90)).toBe(1);
    expect((await listTraces({ limit: 500 })).length).toBe(before - 1);
  });

  it('マイグレーションの適用履歴が記録される', async () => {
    const { getDb } = await import('@/lib/server/db');
    const rows = await (await getDb()).query<{ id: string }>('SELECT id FROM rc_schema_migrations');
    expect(rows.map((r) => r.id)).toContain('2026-10-29-001-risk-intelligence');
  });
});
