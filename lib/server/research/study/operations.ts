import { randomUUID } from 'node:crypto';
import type { Study } from '@/lib/research/study-types';
import { audit } from '../../audit';
import type { Principal } from '../../auth/types';
import { getDb } from '../../db';
import { getConfig } from '../../storage/store';
import { getStudy, insertStudy, sessionCounts, studyLiveness, studySpentUsd, updateStudy } from '../../storage/studyStore';
import { findPrice } from '../pricing';
import { ValidationError } from '../providers';
import { resolveAgentRole } from './studies';

// 研究の運用: 複製・費用の事前見積もり・費用の上限の変更・処理の状況。

/** 研究を複製して新しい下書きにする（研究デザインのみ。結果・凍結した設定は複製しない） */
export async function duplicateStudy(id: string, actor: Principal): Promise<Study> {
  const source = await getStudy(id);
  if (!source) throw new ValidationError('研究が見つかりません。');
  const now = new Date().toISOString();
  const copy: Study = {
    id: randomUUID(),
    status: 'draft',
    statusReason: null,
    design: { ...structuredClone(source.design), title: `${source.design.title}（複製）`.slice(0, 120) },
    frozen: null,
    frozenHash: null,
    isMock: source.design.agent.kind === 'mock',
    createdAt: now,
    createdBy: actor.displayName,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
    duplicatedFrom: source.id,
  };
  await insertStudy(copy);
  await audit(actor, 'study.duplicate', copy.id, 'success', `複製元: ${source.id}`);
  return copy;
}

/** 費用の上限を変更する（研究の条件ではないため、開始後も変更できる。完了した研究は不可） */
export async function updateStudyBudget(id: string, maxCostUsd: unknown, actor: Principal): Promise<Study> {
  const value = maxCostUsd === null || maxCostUsd === '' || maxCostUsd === undefined ? null : Number(maxCostUsd);
  if (value !== null && (!Number.isFinite(value) || value < 0.01 || value > 100_000)) throw new ValidationError('費用の上限は 0.01〜100,000 ドルで指定してください。', 'maxCostUsd');
  const updated = await updateStudy(id, (s) => {
    if (s.status === 'completed' || s.status === 'stopped') return null;
    s.design = { ...s.design, maxCostUsd: value };
    return s;
  });
  if (!updated) throw new ValidationError('終了した研究の上限は変更できません。');
  await audit(actor, 'study.budget', id, 'success', `費用の上限: ${value === null ? 'なし' : '$' + value}`);
  return updated;
}

export type StudyEstimate = {
  calls: number;
  providerId: string | null;
  model: string | null;
  tokensPerCall: { input: number; output: number; basis: 'observed' | 'assumed' };
  price: { inputPerMTok: number; outputPerMTok: number; source: string | null } | null;
  /** 単価が未登録なら null（推測の費用は表示しない） */
  estimatedUsd: number | null;
  spentUsd: number;
  maxCostUsd: number | null;
  note: string | null;
};

/** 想定の入力トークン数（同じモデルの実績がない場合の目安。研究のプロンプトは市場の状況と規則で 1,000〜2,000 程度） */
const ASSUMED_INPUT_TOKENS = 2_000;

/**
 * API 費用の事前見積もり。呼び出し回数 = 条件数 × 反復数 × ステップ数（取引エージェントは1ステップ1回）。
 * 1回あたりのトークン数は、同じモデルの過去の実績（直近 500 回）の平均、なければ想定値（出力は最大出力トークン数）。
 */
export async function estimateStudy(id: string): Promise<StudyEstimate> {
  const study = await getStudy(id);
  if (!study) throw new ValidationError('研究が見つかりません。');
  const d = study.design;
  const spentUsd = await studySpentUsd(id);
  const base = { spentUsd, maxCostUsd: d.maxCostUsd ?? null };
  if (d.agent.kind === 'mock') {
    return { calls: 0, providerId: null, model: null, tokensPerCall: { input: 0, output: 0, basis: 'assumed' }, price: null, estimatedUsd: 0, ...base, note: 'モック（決定論的なエージェント）は API を呼び出しません。' };
  }
  const counts = await sessionCounts(id);
  const totalSessions = d.conditions.length * d.replicates;
  const remainingSessions = study.status === 'draft' ? totalSessions : (counts.pending ?? 0) + (counts.running ?? 0);
  const calls = remainingSessions * d.market.steps;
  const config = await getConfig();
  let role;
  try {
    role = study.frozen?.agentRole ?? resolveAgentRole(config, d);
  } catch (e) {
    return { calls, providerId: null, model: null, tokensPerCall: { input: 0, output: 0, basis: 'assumed' }, price: null, estimatedUsd: null, ...base, note: (e as Error).message };
  }
  const db = await getDb();
  const obs = await db.query<{ n: number; input: string | number | null; output: string | number | null }>(
    `SELECT count(*)::int AS n, avg((data->'usage'->>'inputTokens')::numeric) AS input, avg((data->'usage'->>'outputTokens')::numeric) AS output
       FROM (SELECT data FROM rc_usage_records WHERE data->>'model' = $1 AND data->>'providerId' = $2 AND (data->>'ok')::boolean AND data->>'role' = 'trading_agent'
             ORDER BY at DESC LIMIT 500) r`,
    [role.model, role.providerId],
  );
  const observed = (obs[0]?.n ?? 0) >= 5;
  const tokensPerCall = observed
    ? { input: Math.round(Number(obs[0].input)), output: Math.round(Number(obs[0].output)), basis: 'observed' as const }
    : { input: ASSUMED_INPUT_TOKENS, output: role.maxOutputTokens, basis: 'assumed' as const };
  const p = findPrice(config.prices, role.providerId, role.model);
  const price = p ? { inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok, source: p.source ?? null } : null;
  const estimatedUsd = price ? Math.round(((calls * (tokensPerCall.input * price.inputPerMTok + tokensPerCall.output * price.outputPerMTok)) / 1_000_000) * 100) / 100 : null;
  return {
    calls,
    providerId: role.providerId,
    model: role.model,
    tokensPerCall,
    price,
    estimatedUsd,
    ...base,
    note: price ? (observed ? null : '同じモデルの実績がないため、1回あたりのトークン数は想定値（出力は最大値）で見積もっています。') : 'このモデルの単価が「費用管理」に登録されていないため、費用を見積もれません。',
  };
}

export { studyLiveness };
