import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// PoC の価値測定と、監視（試験版）: 認証・入力の検証・重複・上限・一次判定・警告・テナントの分離。

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: ['research:read', 'research:run', 'settings:read', 'settings:write', 'credentials:write', 'audit:read'] as never[], authMethod: 'basic' as const };

beforeAll(async () => {
  await setupEnv();
});
afterAll(async () => {
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

async function studyWithFailures() {
  const { createPairFromTemplate } = await import('@/lib/server/research/study/rules');
  const { createStudy, startStudy, waitForStudy } = await import('@/lib/server/research/study/studies');
  const { detectFailures } = await import('@/lib/server/research/failure/failures');
  const { ruleA, ruleB } = await createPairFromTemplate('spoof_and_or', actor);
  const s = await createStudy({ title: 'poc', conditions: [{ id: 'A', label: 'A', ruleVersionIds: [ruleA.id] }, { id: 'B', label: 'B', ruleVersionIds: [ruleB.id] }], replicates: 4, market: { steps: 12 } }, actor);
  await startStudy(s.id, actor);
  await waitForStudy(s.id);
  await detectFailures(s.id, actor);
  return { studyId: s.id, ruleA, ruleB };
}

describe('PoC の価値測定', () => {
  it('未確認の疑いは発見として数えず、推定の時間は推定として扱う', async () => {
    const { studyId } = await studyWithFailures();
    const { createPoc, updatePoc, computePocMetrics, pocMarkdown, pocCsv } = await import('@/lib/server/research/poc/poc');
    const { listFailures } = await import('@/lib/server/storage/failureStore');
    const { reviewFailure } = await import('@/lib/server/research/failure/failures');
    let poc = await createPoc({ name: 'テスト PoC', purpose: '検証' }, actor);
    let m = await computePocMetrics(poc);
    expect(m.time.savedMinutes).toBeNull();
    expect(m.detection.confirmedFindings).toBe(0);
    poc = await updatePoc(poc.id, { op: 'link_study', studyId }, actor);
    m = await computePocMetrics(poc);
    // まだ誰も確認していない
    expect(m.detection.confirmedFindings).toBe(0);
    expect(m.detection.unreviewed).toBeGreaterThan(0);
    expect(m.dataNotice.join()).toContain('モックデータ');
    expect(m.auditability.traceableRate).toBe(1);
    expect(m.auditability.reproducibleRate).toBe(1);
    expect(m.time.systemMinutes).toBeGreaterThanOrEqual(0);
    // 形式違反と趣旨逸脱を1件ずつ確認する
    const failures = await listFailures({ studyId });
    const formal = failures.find((f) => f.category === 'formal_violation')!;
    const intent = failures.find((f) => f.category === 'intent_deviation');
    await reviewFailure(formal.id, { status: 'confirmed' }, actor);
    if (intent) await reviewFailure(intent.id, { status: 'confirmed' }, actor);
    await reviewFailure(failures.find((f) => f.id !== formal.id && f.id !== intent?.id)!.id, { status: 'dismissed' }, actor);
    m = await computePocMetrics(poc);
    expect(m.detection.confirmedFindings).toBe(intent ? 2 : 1);
    expect(m.detection.novelFindings).toBe(intent ? 1 : 0);
    expect(m.detection.falsePositives).toBe(1);
    // 時間（推定）と、専門家だけが見つけた発見（見逃し）
    await expect(updatePoc(poc.id, { op: 'add_time', phase: 'baseline', activity: 'risk_review', minutes: 120 }, actor)).rejects.toThrow(/実測か推定/);
    await updatePoc(poc.id, { op: 'add_time', phase: 'baseline', activity: 'risk_review', minutes: 120, kind: 'estimated' }, actor);
    poc = await updatePoc(poc.id, { op: 'add_time', phase: 'human', activity: 'risk_review', minutes: 30, kind: 'measured' }, actor);
    poc = await updatePoc(poc.id, { op: 'upsert_finding', finding: { title: '専門家のみ', foundByKisei: false, foundByExpert: true, expertReview: 'confirmed' } }, actor);
    m = await computePocMetrics(poc);
    expect(m.time.savedMinutes).toBe(90);
    expect(m.time.baselineEstimated).toBe(true);
    expect(m.detection.falseNegatives).toBe(1);
    expect(m.detection.detectionCoverage).toBeCloseTo((intent ? 2 : 1) / ((intent ? 2 : 1) + 1 + 1), 10);
    const md = pocMarkdown(poc, m, []);
    for (const h of ['1. 検証目的', '2. 比較対象', '5. 検出された問題', '7. 修正案', '10. 費用・時間', '11. 制約と不確実性', '12. 導入判断に必要な残課題']) expect(md).toContain(h);
    expect(md).toContain('推定値を含む');
    expect(pocCsv(m)).toContain('confirmed_findings');
  });
});

describe('監視（試験版）', () => {
  it('トークン認証・入力の検証・重複の排除・一次判定・既知の Failure との類似・警告', async () => {
    const { ruleB } = await studyWithFailures();
    const { createSource, ingestEvents, parseEvent, hashToken, monitoringOverview, setAlertStatus, monitoringAuditReport, sendSampleEvents } = await import('@/lib/server/research/monitor/monitor');
    const { getSourceByTokenHash, listEvents, listAlerts } = await import('@/lib/server/storage/monitorStore');
    await expect(createSource({ name: 'x', ruleVersionIds: [] }, actor)).rejects.toThrow(/規則/);
    const { source, token } = await createSource({ name: '取引エージェント', ruleVersionIds: [ruleB.id], alertViolationRate: 0.1, hourlyEventCap: 60 }, actor);
    expect(token).toMatch(/^ksm_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(source)).not.toContain(token);
    expect((await getSourceByTokenHash(hashToken(token)))!.id).toBe(source.id);
    expect(await getSourceByTokenHash(hashToken(`${token}x`))).toBeNull();

    // スキーマ外の項目・不正な値は拒否する
    const ev = (i: number, extra: Record<string, unknown> = {}) => ({ idempotencyKey: `k-${i}`, occurredAt: '2026-10-29T00:00:00Z', agentId: 'agent-1', action: 'buy', quantity: 700, state: { price: 1000, lastTradePrice: 1000, cash: 1e6, position: 0 }, ...extra });
    expect(() => parseEvent({ ...ev(0), password: 'x' })).toThrow(/使用できない項目/);
    expect(() => parseEvent({ ...ev(0), quantity: -1 })).toThrow(/quantity/);
    expect(() => parseEvent({ ...ev(0), action: 'cancel' })).toThrow(/cancel/);

    const r1 = await ingestEvents(source, { events: Array.from({ length: 12 }, (_, i) => ev(i, { rationale: '連絡先 user@example.com sk-test-abcdefghijk' })) });
    expect(r1).toMatchObject({ accepted: 12, duplicates: 0, flagged: 12 });
    // 同じ冪等キーは重複して保存しない
    expect(await ingestEvents(source, ev(0))).toMatchObject({ accepted: 0, duplicates: 1 });
    const stored = await listEvents('default', { sourceId: source.id });
    expect(stored).toHaveLength(12);
    expect(stored[0].result).toMatchObject({ verdict: 'REJECT', ruleViolation: true, codes: ['SPOOF_LARGE_ORDER'] });
    // 説明の本文は既定で保存しない
    expect(stored[0].input.rationale).toBeUndefined();
    const alerts = await listAlerts('default', { sourceId: source.id });
    expect(alerts.some((a) => a.type === 'violation_rate')).toBe(true);
    // 同じ警告は重複して作らない
    await ingestEvents(source, ev(100));
    expect((await listAlerts('default', { sourceId: source.id })).filter((a) => a.type === 'violation_rate')).toHaveLength(1);
    const a = alerts.find((x) => x.type === 'violation_rate')!;
    expect((await setAlertStatus(a.id, 'acknowledged', actor)).updatedBy).toBe('研究チーム');

    // 1時間あたりの上限
    await expect(ingestEvents(source, { events: Array.from({ length: 60 }, (_, i) => ev(200 + i)) })).rejects.toThrow(/上限/);

    // サンプル（モック接続）はサンプルとして保存する
    const sample = await sendSampleEvents(source.id, 5, actor);
    expect(sample.accepted).toBe(5);
    expect((await listEvents('default', { sourceId: source.id })).filter((e) => e.isSample)).toHaveLength(5);
    const report = await monitoringAuditReport('default', source.id);
    expect(report).toContain('サンプル（モック接続）');
    expect(report).toContain('試験版');

    // テナントの分離: 別のテナントからは見えない
    const other = await monitoringOverview('tenant-other');
    expect(other.sources).toHaveLength(0);
    expect(other.alerts).toHaveLength(0);
    expect(await listEvents('tenant-other', { sourceId: source.id })).toHaveLength(0);
    await expect(setAlertStatus(a.id, 'resolved', { ...actor, tenantId: 'tenant-other' })).rejects.toThrow(/見つかりません/);
  });

  it('取り込み API: 不正なトークンは 401、正しいトークンは 202', async () => {
    const { createSource } = await import('@/lib/server/research/monitor/monitor');
    const { listRules } = await import('@/lib/server/research/study/rules');
    const { POST } = await import('@/app/api/monitor/events/route');
    const rule = (await listRules())[0];
    const { token } = await createSource({ name: 'api', ruleVersionIds: [rule.id] }, actor);
    const req = (auth: string, body: unknown) =>
      new Request('http://localhost/api/monitor/events', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' }, body: JSON.stringify(body) });
    const body = { idempotencyKey: 'api-1', occurredAt: '2026-10-29T00:00:00Z', agentId: 'a', action: 'hold', state: { price: 1000, lastTradePrice: 1000, cash: 0, position: 0 } };
    expect((await POST(req('Bearer ksm_wrong', body))).status).toBe(401);
    const ok = await POST(req(`Bearer ${token}`, body));
    expect(ok.status).toBe(202);
    expect(await ok.json()).toMatchObject({ accepted: 1 });
    expect((await POST(req(`Bearer ${token}`, { ...body, action: 'fly' }))).status).toBe(400);
  });
});
