import { reasoningSupport, researchRoles } from '@/lib/research/labels';
import type { AppSettings, ModelPrice, ReasoningEffort, ReasoningSettings, ResearchRole, RoleAssignment } from '@/lib/research/types';
import { getState, updateState } from '../storage/store';
import { ValidationError } from './providers';

const EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const DATE_FORMATS: AppSettings['basic']['dateFormat'][] = ['yyyy/MM/dd HH:mm', 'yyyy-MM-dd HH:mm', 'MM/dd HH:mm'];

function int(value: unknown, label: string, min: number, max: number, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label}は${min}〜${max}の整数で入力してください。`, field);
  return n;
}

function money(value: unknown, label: string, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new ValidationError(`${label}は0以上の数値で入力してください。`, field);
  return Math.round(n * 100) / 100;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('ja-JP', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getSettings(): Promise<AppSettings> {
  return (await getState()).settings;
}

type SettingsPatch = {
  basic?: Partial<Record<keyof AppSettings['basic'], unknown>>;
  execution?: Partial<Record<keyof AppSettings['execution'], unknown>>;
  cost?: Partial<Record<keyof AppSettings['cost'], unknown>>;
};

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  // 先にすべて検証してから保存する（部分的に保存されることを避ける）
  const current = await getSettings();
  const next: AppSettings = structuredClone(current);
  if (patch.basic) {
    const b = patch.basic;
    if (b.appDisplayName !== undefined) {
      const name = typeof b.appDisplayName === 'string' ? b.appDisplayName.trim() : '';
      if (!name || name.length > 60) throw new ValidationError('アプリ表示名は1〜60文字で入力してください。', 'appDisplayName');
      next.basic.appDisplayName = name;
    }
    if (b.language !== undefined) {
      if (b.language !== 'ja') throw new ValidationError('表示言語は現在、日本語のみ選択できます。', 'language');
      next.basic.language = 'ja';
    }
    if (b.timeZone !== undefined) {
      if (typeof b.timeZone !== 'string' || !isValidTimeZone(b.timeZone)) throw new ValidationError('タイムゾーンが正しくありません。', 'timeZone');
      next.basic.timeZone = b.timeZone;
    }
    if (b.dateFormat !== undefined) {
      if (!DATE_FORMATS.includes(b.dateFormat as AppSettings['basic']['dateFormat'])) throw new ValidationError('日付形式が正しくありません。', 'dateFormat');
      next.basic.dateFormat = b.dateFormat as AppSettings['basic']['dateFormat'];
    }
  }
  if (patch.execution) {
    const e = patch.execution;
    if (e.episodeConcurrency !== undefined) next.execution.episodeConcurrency = int(e.episodeConcurrency, '並列エピソード数', 1, 64, 'episodeConcurrency');
    if (e.episodeRetries !== undefined) next.execution.episodeRetries = int(e.episodeRetries, 'エピソード再試行回数', 0, 10, 'episodeRetries');
    if (e.maxConsecutiveFailures !== undefined) {
      next.execution.maxConsecutiveFailures = int(e.maxConsecutiveFailures, '連続失敗の上限', 1, 1000, 'maxConsecutiveFailures');
    }
  }
  if (patch.cost) {
    if (patch.cost.globalMonthlyBudgetUsd !== undefined) {
      next.cost.globalMonthlyBudgetUsd = money(patch.cost.globalMonthlyBudgetUsd, '全体の月間予算', 'globalMonthlyBudgetUsd');
    }
  }
  return updateState((s) => {
    s.settings = next;
    return next;
  });
}

export async function getRoles(): Promise<Record<ResearchRole, RoleAssignment>> {
  return (await getState()).roles;
}

type RolePatch = { providerId?: unknown; model?: unknown; reasoning?: unknown; maxOutputTokens?: unknown };

export async function updateRole(role: string, patch: RolePatch): Promise<RoleAssignment> {
  if (!researchRoles.includes(role as ResearchRole)) throw new ValidationError('役割が正しくありません。');
  const state = await getState();
  const providerId = patch.providerId === '' || patch.providerId === null ? null : patch.providerId;
  const provider = typeof providerId === 'string' ? state.providers.find((p) => p.id === providerId) : null;
  if (providerId !== null && providerId !== undefined && !provider) throw new ValidationError('プロバイダーが見つかりません。', 'providerId');

  const model = patch.model === '' || patch.model === null ? null : patch.model;
  if (model !== null && model !== undefined && (typeof model !== 'string' || model.length > 200 || !/^[\w.:/@+-]+$/.test(model))) {
    throw new ValidationError('モデル名が正しくありません。', 'model');
  }
  const maxOutputTokens = patch.maxOutputTokens === undefined ? undefined : int(patch.maxOutputTokens, '最大出力トークン', 16, 128_000, 'maxOutputTokens');
  if (provider && typeof model === 'string' && maxOutputTokens !== undefined) {
    const info = provider.models.find((m) => m.id === model);
    if (info?.maxOutputTokens && maxOutputTokens > info.maxOutputTokens) {
      throw new ValidationError(`このモデルの最大出力トークンは ${info.maxOutputTokens} です。`, 'maxOutputTokens');
    }
  }

  let reasoning: ReasoningSettings | undefined;
  if (patch.reasoning !== undefined) {
    const r = (patch.reasoning ?? {}) as Record<string, unknown>;
    const type = provider?.type ?? state.providers.find((p) => p.id === state.roles[role as ResearchRole].providerId)?.type;
    const support = type ? reasoningSupport[type] : 'none';
    reasoning = {};
    if (support === 'effort' && r.effort) {
      if (!EFFORTS.includes(r.effort as ReasoningEffort)) throw new ValidationError('推論の深さが正しくありません。', 'effort');
      reasoning.effort = r.effort as ReasoningEffort;
    }
    if (support === 'thinkingBudget' && r.thinkingBudget !== undefined && r.thinkingBudget !== null && r.thinkingBudget !== '') {
      reasoning.thinkingBudget = int(r.thinkingBudget, '思考トークン予算', -1, 128_000, 'thinkingBudget');
    }
  }

  return updateState((s) => {
    const current = s.roles[role as ResearchRole];
    if (providerId !== undefined) {
      if (providerId !== current.providerId) current.reasoning = {};
      current.providerId = providerId as string | null;
    }
    if (model !== undefined) current.model = model as string | null;
    if (maxOutputTokens !== undefined) current.maxOutputTokens = maxOutputTokens;
    if (reasoning !== undefined) current.reasoning = reasoning;
    current.updatedAt = new Date().toISOString();
    return current;
  });
}

export async function listPrices(): Promise<ModelPrice[]> {
  return (await getState()).prices;
}

export async function upsertPrice(input: Record<string, unknown>): Promise<ModelPrice> {
  const state = await getState();
  const providerId = typeof input.providerId === 'string' ? input.providerId : '';
  if (!state.providers.some((p) => p.id === providerId)) throw new ValidationError('プロバイダーを選択してください。', 'providerId');
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > 200) throw new ValidationError('モデル名を入力してください。', 'model');
  const req = (v: unknown, label: string, field: string) => {
    const n = money(v, label, field);
    if (n === null) throw new ValidationError(`${label}を入力してください。`, field);
    return Number(v);
  };
  const opt = (v: unknown, label: string, field: string) => (v === null || v === undefined || v === '' ? null : req(v, label, field));
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  if (!source || source.length > 300) {
    throw new ValidationError('単価の出典（料金表のURLや確認日など）を入力してください。推測値を登録しないための必須項目です。', 'source');
  }
  const price: ModelPrice = {
    providerId,
    model,
    inputPerMTok: req(input.inputPerMTok, '入力単価', 'inputPerMTok'),
    outputPerMTok: req(input.outputPerMTok, '出力単価', 'outputPerMTok'),
    cachedInputPerMTok: opt(input.cachedInputPerMTok, 'キャッシュ読み取り単価', 'cachedInputPerMTok'),
    cacheWritePerMTok: opt(input.cacheWritePerMTok, 'キャッシュ書き込み単価', 'cacheWritePerMTok'),
    source,
    updatedAt: new Date().toISOString(),
  };
  return updateState((s) => {
    s.prices = s.prices.filter((p) => !(p.providerId === providerId && p.model === model));
    s.prices.push(price);
    return price;
  });
}

export async function deletePrice(providerId: string, model: string): Promise<void> {
  await updateState((s) => {
    s.prices = s.prices.filter((p) => !(p.providerId === providerId && p.model === model));
  });
}
