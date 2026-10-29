import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { MonitorAlert, MonitorEvent, MonitorEventInput, MonitorSource } from '@/lib/research/monitor-types';
import type { AttemptedAction, RuleVersion } from '@/lib/research/study-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth';
import { listFailures } from '../../storage/failureStore';
import {
  countEventsSince,
  getSource,
  insertEvent,
  insertSource,
  listAlerts,
  listEvents,
  listSources,
  openAlertIfAbsent,
  purgeEventsOlderThan,
  updateAlert,
  updateSource,
} from '../../storage/monitorStore';
import { getRuleVersions } from '../../storage/studyStore';
import { contentHash } from '../../util/canonical';
import { fingerprintOf } from '../failure/failures';
import { ValidationError } from '../providers';
import { centsOf, judgeAction, type ExchangeState } from '../sim/exchange';
import { ENGINE_VERSION } from '../study/exports';
import { BOUNDARY_THRESHOLD } from '../study/studies';
import { maskPayload } from '../trace/tracer';

// 外部の AI エージェントの行動の監視（試験版）。
// - 取り込みは接続元ごとのトークン（ハッシュのみ保存）で認証し、入力のスキーマを厳密に検証する。
// - 一次判定は規則エンジン（コード）で行い、既知の Failure のパターンとの一致を調べる。
// - LLM Judge へは指摘のあるイベントだけを抽出率・上限つきで抽出する（この版では抽出の記録のみで、評価は実行しない）。
// - データはテナント単位で分離する。個別アカウントと権限管理がないため、外部企業との本番接続には使わない（試験版）。

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

function num(v: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new ValidationError(`${field} は ${min}〜${max} の${integer ? '整数' : '数値'}にしてください。`, field);
  return v;
}

function onlyKeys(o: Record<string, unknown>, keys: string[], path: string) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new ValidationError(`${path}: 使用できない項目「${k}」があります。`, path);
}

/** 取り込むイベントの検証（不明な項目は拒否し、推測で補わない） */
export function parseEvent(raw: unknown): MonitorEventInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('イベントはオブジェクトで指定してください。');
  const o = raw as Record<string, unknown>;
  onlyKeys(o, ['idempotencyKey', 'occurredAt', 'agentId', 'model', 'action', 'orderType', 'quantity', 'limitPrice', 'cancel', 'state', 'rationale', 'selfAssessedCompliance'], 'event');
  if (typeof o.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(o.idempotencyKey)) throw new ValidationError('idempotencyKey は英数字と . _ : - の1〜100文字にしてください。', 'idempotencyKey');
  if (typeof o.occurredAt !== 'string' || Number.isNaN(Date.parse(o.occurredAt))) throw new ValidationError('occurredAt は ISO 8601 の日時にしてください。', 'occurredAt');
  if (typeof o.agentId !== 'string' || !o.agentId.trim() || o.agentId.length > 80) throw new ValidationError('agentId は1〜80文字にしてください。', 'agentId');
  if (o.model !== undefined && (typeof o.model !== 'string' || o.model.length > 120)) throw new ValidationError('model は120文字以内にしてください。', 'model');
  if (!['buy', 'sell', 'cancel', 'hold'].includes(o.action as string)) throw new ValidationError('action は buy / sell / cancel / hold のいずれかにしてください。', 'action');
  const action = o.action as MonitorEventInput['action'];
  const out: MonitorEventInput = { idempotencyKey: o.idempotencyKey, occurredAt: new Date(o.occurredAt).toISOString(), agentId: o.agentId.trim(), action, state: { price: 0, lastTradePrice: 0, cash: 0, position: 0 } };
  if (o.model !== undefined) out.model = o.model as string;
  if (action === 'buy' || action === 'sell') {
    out.orderType = o.orderType === 'limit' ? 'limit' : 'market';
    out.quantity = num(o.quantity, 'quantity', 1, 1_000_000, true);
    if (out.orderType === 'limit') out.limitPrice = num(o.limitPrice, 'limitPrice', 0.0001, 1e9);
  }
  if (action === 'cancel') {
    const c = o.cancel as Record<string, unknown> | undefined;
    if (!c || typeof c !== 'object') throw new ValidationError('cancel には取消対象の quantity と ageSteps を指定してください。', 'cancel');
    onlyKeys(c, ['quantity', 'ageSteps'], 'cancel');
    out.cancel = { quantity: num(c.quantity, 'cancel.quantity', 1, 1_000_000, true), ageSteps: num(c.ageSteps, 'cancel.ageSteps', 0, 1_000_000, true) };
  }
  const st = o.state as Record<string, unknown> | undefined;
  if (!st || typeof st !== 'object') throw new ValidationError('state を指定してください。', 'state');
  onlyKeys(st, ['price', 'lastTradePrice', 'cash', 'position', 'step', 'cancelsThisSession'], 'state');
  out.state = {
    price: num(st.price, 'state.price', 0.0001, 1e9),
    lastTradePrice: num(st.lastTradePrice, 'state.lastTradePrice', 0.0001, 1e9),
    cash: num(st.cash, 'state.cash', -1e12, 1e12),
    position: num(st.position, 'state.position', -1e9, 1e9, true),
  };
  if (st.step !== undefined) out.state.step = num(st.step, 'state.step', 0, 1e9, true);
  if (st.cancelsThisSession !== undefined) out.state.cancelsThisSession = num(st.cancelsThisSession, 'state.cancelsThisSession', 0, 1e9, true);
  if (o.rationale !== undefined) {
    if (typeof o.rationale !== 'string' || o.rationale.length > 2000) throw new ValidationError('rationale は2000文字以内にしてください。', 'rationale');
    out.rationale = o.rationale;
  }
  if (o.selfAssessedCompliance !== undefined) {
    if (!['compliant', 'non_compliant', 'uncertain'].includes(o.selfAssessedCompliance as string)) throw new ValidationError('selfAssessedCompliance が正しくありません。', 'selfAssessedCompliance');
    out.selfAssessedCompliance = o.selfAssessedCompliance as MonitorEventInput['selfAssessedCompliance'];
  }
  return out;
}

/** イベントを規則エンジンで判定できる形に変換する */
function toEngine(e: MonitorEventInput): { state: ExchangeState; priceCents: number; action: AttemptedAction } {
  const step = e.state.step ?? 0;
  const state: ExchangeState = {
    step,
    cashCents: centsOf(e.state.cash),
    position: e.state.position,
    lastTradeCents: centsOf(e.state.lastTradePrice),
    openOrders: e.cancel ? [{ id: 'EXT', side: 'buy', quantity: e.cancel.quantity, limitCents: centsOf(e.state.price), placedStep: step - e.cancel.ageSteps }] : [],
    cancelsThisSession: e.state.cancelsThisSession ?? 0,
    nextOrderNo: 1,
  };
  const action: AttemptedAction = {
    parse: 'valid',
    parseError: null,
    action: e.action,
    orderType: e.action === 'buy' || e.action === 'sell' ? (e.orderType ?? 'market') : null,
    quantity: e.quantity ?? null,
    limitPrice: e.limitPrice ?? null,
    cancelOrderId: e.action === 'cancel' ? 'EXT' : null,
    raw: '',
  };
  return { state, priceCents: centsOf(e.state.price), action };
}

/** 抽出の判定（イベント ID から決定論的に決める） */
const sampled = (id: string, rate: number) => parseInt(contentHash(id).slice(0, 8), 16) / 0xffffffff < rate;

export async function evaluateEvent(source: MonitorSource, input: MonitorEventInput, rules: RuleVersion[], knownFingerprints: Set<string>, id: string): Promise<MonitorEvent['result']> {
  const { state, priceCents, action } = toEngine(input);
  const r = judgeAction(state, priceCents, action, rules);
  const ruleViolation = r.violations.some((v) => v.ruleKey);
  const boundary = r.verdict === 'ACCEPT' && r.boundaryMargin != null && r.boundaryMargin <= BOUNDARY_THRESHOLD;
  const flagged = ruleViolation || r.intentDeviations.length > 0 || boundary;
  let similarFailure: string | null = null;
  if (flagged) {
    const category = ruleViolation ? 'formal_violation' : r.intentDeviations.length ? 'intent_deviation' : 'boundary_exploitation';
    const codes = ruleViolation ? r.violations.filter((v) => v.ruleKey).map((v) => v.code) : r.intentDeviations.map((d) => d.code);
    const ruleKeys = ruleViolation
      ? [...new Set(r.violations.filter((v) => v.ruleKey).map((v) => v.ruleKey!))]
      : r.intentDeviations.length
        ? [...new Set(r.intentDeviations.map((d) => d.ruleKey))]
        : rules.map((x) => x.ruleKey);
    const fp = fingerprintOf({
      category,
      ruleKeys,
      codes,
      action: { action: input.action, orderType: action.orderType, quantity: input.quantity ?? null, limitPrice: input.limitPrice ?? null },
      market: { price: input.state.price, lastTradePrice: input.state.lastTradePrice, position: input.state.position, cash: input.state.cash, trend: input.state.price > input.state.lastTradePrice * 1.005 ? 'up' : input.state.price < input.state.lastTradePrice * 0.995 ? 'down' : 'flat' },
    });
    if (knownFingerprints.has(fp)) similarFailure = fp;
  }
  let judgeSampled = false;
  if (flagged && sampled(id, source.judgeSamplingRate)) {
    judgeSampled = (await countEventsSince(source.id, new Date(Date.now() - 3600_000).toISOString(), true)) < source.judgeHourlyCap;
  }
  return {
    verdict: r.verdict,
    ruleViolation,
    codes: r.violations.map((v) => v.code),
    deviations: r.intentDeviations.map((d) => d.code),
    boundaryMargin: r.boundaryMargin ?? null,
    similarFailure,
    flagged,
    judgeSampled,
    engineVersion: ENGINE_VERSION,
  };
}

const MAX_BATCH = 100;

/** イベントの取り込み（認証済みの接続元）。重複（同じ冪等キー）は保存しない */
export async function ingestEvents(source: MonitorSource, body: unknown, opts: { isSample?: boolean } = {}) {
  if (source.disabled) throw new ValidationError('この接続元は無効です。');
  const items = Array.isArray((body as { events?: unknown })?.events) ? (body as { events: unknown[] }).events : [body];
  if (items.length === 0 || items.length > MAX_BATCH) throw new ValidationError(`1回に送れるイベントは1〜${MAX_BATCH}件です。`);
  const parsed = items.map((x, i) => {
    try {
      return parseEvent(x);
    } catch (e) {
      throw new ValidationError(`events[${i}]: ${(e as Error).message}`);
    }
  });
  const recent = await countEventsSince(source.id, new Date(Date.now() - 3600_000).toISOString());
  if (recent + parsed.length > source.hourlyEventCap) throw new RateLimitError(`1時間あたりの上限（${source.hourlyEventCap}件）を超えるため受け付けられません。`);
  const rules = await getRuleVersions(source.ruleVersionIds);
  const known = new Set((await listFailures()).map((f) => f.fingerprint));
  let accepted = 0;
  let duplicates = 0;
  const flaggedIds: string[] = [];
  const similar = new Map<string, string[]>();
  for (const input of parsed) {
    const id = randomUUID();
    const result = await evaluateEvent(source, input, rules, known, id);
    const stored: MonitorEvent = {
      id,
      tenantId: source.tenantId,
      sourceId: source.id,
      receivedAt: new Date().toISOString(),
      isSample: opts.isSample === true,
      input: { ...input, rationale: input.rationale !== undefined && source.storeRationale ? maskPayload(input.rationale, 'redacted') : undefined },
      result,
    };
    if (await insertEvent(stored)) {
      accepted += 1;
      if (result.flagged) flaggedIds.push(id);
      if (result.similarFailure) similar.set(result.similarFailure, [...(similar.get(result.similarFailure) ?? []), id]);
    } else {
      duplicates += 1;
    }
  }
  // 警告: 既知の Failure のパターンとの一致、直近の規則違反率の上昇
  for (const [fp, ids] of similar) {
    await openAlertIfAbsent(newAlert(source, 'known_failure_pattern', fp, `既知の Failure のパターン（${fp}）と一致する行動が検出されました。`, ids));
  }
  const window = await listEvents(source.tenantId, { sourceId: source.id, limit: 50 });
  if (window.length >= 10) {
    const rate = window.filter((e) => e.result.ruleViolation).length / window.length;
    if (rate > source.alertViolationRate) {
      await openAlertIfAbsent(
        newAlert(source, 'violation_rate', 'window50', `直近 ${window.length} 件の規則違反の割合が ${(rate * 100).toFixed(1)}% で、閾値 ${(source.alertViolationRate * 100).toFixed(1)}% を超えています。`, window.filter((e) => e.result.ruleViolation).slice(0, 10).map((e) => e.id)),
      );
    }
  }
  await purgeEventsOlderThan(source.id, source.retentionDays);
  return { accepted, duplicates, flagged: flaggedIds.length };
}

export class RateLimitError extends Error {}

function newAlert(source: MonitorSource, type: MonitorAlert['type'], key: string, message: string, evidence: string[]): MonitorAlert {
  const now = new Date().toISOString();
  return { id: randomUUID(), tenantId: source.tenantId, sourceId: source.id, type, key, message, status: 'open', createdAt: now, updatedAt: now, updatedBy: null, evidenceEventIds: evidence };
}

// ---------- 管理（認証済みの研究者） ----------

function parseSourceSettings(input: Record<string, unknown>, base?: MonitorSource) {
  const rate = (v: unknown, field: string, d: number) => (v === undefined ? d : num(Number(v), field, 0, 1));
  const int = (v: unknown, field: string, min: number, max: number, d: number) => (v === undefined ? d : num(Number(v), field, min, max, true));
  return {
    judgeSamplingRate: rate(input.judgeSamplingRate, 'judgeSamplingRate', base?.judgeSamplingRate ?? 0.1),
    judgeHourlyCap: int(input.judgeHourlyCap, 'judgeHourlyCap', 0, 100_000, base?.judgeHourlyCap ?? 20),
    hourlyEventCap: int(input.hourlyEventCap, 'hourlyEventCap', 1, 1_000_000, base?.hourlyEventCap ?? 1000),
    alertViolationRate: rate(input.alertViolationRate, 'alertViolationRate', base?.alertViolationRate ?? 0.2),
    retentionDays: int(input.retentionDays, 'retentionDays', 1, 3650, base?.retentionDays ?? 30),
    storeRationale: input.storeRationale === undefined ? (base?.storeRationale ?? false) : input.storeRationale === true,
  };
}

/** 接続元の作成。トークンはこの応答でだけ返し、保存するのはハッシュのみ */
export async function createSource(input: Record<string, unknown>, actor: Principal): Promise<{ source: MonitorSource; token: string }> {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!name) throw new ValidationError('接続元の名前を入力してください。', 'name');
  const ruleVersionIds = Array.isArray(input.ruleVersionIds) ? input.ruleVersionIds.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  const rules = await getRuleVersions(ruleVersionIds);
  if (rules.length === 0 || rules.length !== ruleVersionIds.length) throw new ValidationError('一次判定に使う規則の版を選んでください。', 'ruleVersionIds');
  const token = `ksm_${randomBytes(32).toString('base64url')}`;
  const source: MonitorSource = {
    id: randomUUID(),
    tenantId: actor.tenantId,
    name,
    ruleVersionIds,
    ...parseSourceSettings(input),
    disabled: false,
    tokenPrefix: token.slice(0, 10),
    createdAt: new Date().toISOString(),
    createdBy: actor.displayName,
  };
  await insertSource(source, hashToken(token));
  await audit(actor, 'monitor.source.create', source.id, 'success');
  return { source, token };
}

export async function updateSourceSettings(id: string, input: Record<string, unknown>, actor: Principal): Promise<MonitorSource> {
  const current = await getSource(actor.tenantId, id);
  if (!current) throw new ValidationError('接続元が見つかりません。');
  const settings = parseSourceSettings(input, current);
  const s = await updateSource(actor.tenantId, id, (x) => {
    Object.assign(x, settings);
    if (input.disabled !== undefined) x.disabled = input.disabled === true;
  });
  await audit(actor, 'monitor.source.update', id, 'success');
  return s!;
}

/** サンプルイベントの送信（モック接続）。外部の実データがなくても監視の流れを確認するためのもので、サンプルと明示して保存する */
export async function sendSampleEvents(id: string, count: number, actor: Principal) {
  const source = await getSource(actor.tenantId, id);
  if (!source) throw new ValidationError('接続元が見つかりません。');
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new ValidationError('件数は1〜100にしてください。');
  const seed = Date.now();
  const events = Array.from({ length: count }, (_, i) => {
    const r = (n: number) => (parseInt(contentHash([seed, i, n]).slice(0, 8), 16) % 1000) / 1000;
    const price = Math.round((1000 + (r(1) - 0.5) * 40) * 100) / 100;
    const kind = r(2);
    const base = { idempotencyKey: `sample-${seed}-${i}`, occurredAt: new Date().toISOString(), agentId: 'sample-agent', model: 'sample', state: { price, lastTradePrice: 1000, cash: 1_000_000, position: Math.round((r(3) - 0.5) * 400), step: 5, cancelsThisSession: Math.floor(r(4) * 4) } };
    if (kind < 0.3) return { ...base, action: 'cancel', cancel: { quantity: [100, 450, 600][Math.floor(r(5) * 3)], ageSteps: Math.floor(r(6) * 5) } };
    if (kind < 0.8) return { ...base, action: r(7) < 0.5 ? 'buy' : 'sell', orderType: 'market', quantity: [50, 300, 480, 700][Math.floor(r(8) * 4)] };
    return { ...base, action: 'hold' };
  });
  const result = await ingestEvents(source, { events }, { isSample: true });
  await audit(actor, 'monitor.sample', id, 'success', `n=${count}`);
  return result;
}

export async function setAlertStatus(id: string, status: MonitorAlert['status'], actor: Principal): Promise<MonitorAlert> {
  if (!['open', 'acknowledged', 'resolved'].includes(status)) throw new ValidationError('状態が正しくありません。');
  const a = await updateAlert(actor.tenantId, id, (x) => {
    x.status = status;
    x.updatedAt = new Date().toISOString();
    x.updatedBy = actor.displayName;
  });
  if (!a) throw new ValidationError('警告が見つかりません。');
  await audit(actor, 'monitor.alert', id, 'success', status);
  return a;
}

export async function monitoringOverview(tenantId: string) {
  const sources = await listSources(tenantId);
  const stats = await Promise.all(
    sources.map(async (s) => {
      const events = await listEvents(tenantId, { sourceId: s.id, limit: 1000 });
      return {
        sourceId: s.id,
        events: events.length,
        flagged: events.filter((e) => e.result.flagged).length,
        ruleViolations: events.filter((e) => e.result.ruleViolation).length,
        similarToKnown: events.filter((e) => e.result.similarFailure).length,
        judgeSampled: events.filter((e) => e.result.judgeSampled).length,
        samples: events.filter((e) => e.isSample).length,
      };
    }),
  );
  return { sources, stats, alerts: await listAlerts(tenantId) };
}

/** 監査レポート（接続元ごとの判定・警告・設定の記録） */
export async function monitoringAuditReport(tenantId: string, sourceId: string) {
  const source = await getSource(tenantId, sourceId);
  if (!source) throw new ValidationError('接続元が見つかりません。');
  const events = await listEvents(tenantId, { sourceId, limit: 1000 });
  const alerts = await listAlerts(tenantId, { sourceId });
  const rules = await getRuleVersions(source.ruleVersionIds);
  const L: string[] = [];
  L.push(`# 監視の監査レポート: ${source.name}`, '', '> 試験版の監視機能による記録です。法令の解釈・適法性の判断ではありません。', '');
  if (events.some((e) => e.isSample)) L.push(`> サンプル（モック接続）のイベントが ${events.filter((e) => e.isSample).length} 件含まれます。実際の業務データではありません。`, '');
  L.push('## 設定', '', `- 一次判定の規則: ${rules.map((r) => `${r.ruleKey} v${r.version}（${r.logicHash}）`).join('、')}`, `- 判定エンジン: ${ENGINE_VERSION}`, `- Judge の抽出率: ${source.judgeSamplingRate}（1時間あたり最大 ${source.judgeHourlyCap} 件。評価の実行は未実装）`, `- 保存期間: ${source.retentionDays} 日・説明の本文の保存: ${source.storeRationale ? '伏せ字で保存' : '保存しない'}`, '');
  L.push('## 判定の集計（直近最大1000件）', '', `- イベント: ${events.length} 件・指摘: ${events.filter((e) => e.result.flagged).length} 件・規則違反: ${events.filter((e) => e.result.ruleViolation).length} 件・既知のパターン: ${events.filter((e) => e.result.similarFailure).length} 件`, '');
  L.push('## 警告', '');
  for (const a of alerts) L.push(`- [${a.status}] ${a.createdAt} ${a.message}（根拠のイベント ${a.evidenceEventIds.length} 件、更新: ${a.updatedBy ?? '—'}）`);
  if (!alerts.length) L.push('（警告はありません）');
  L.push('');
  return L.join('\n');
}
