import { randomUUID } from 'node:crypto';
import { apiKeyRequired, defaultBaseUrls } from '@/lib/research/labels';
import type { ModelInfo, ProviderConnection, ProviderDTO, ProviderType } from '@/lib/research/types';
import { decryptSecret, encryptSecret, maskSecret } from '../crypto/secretBox';
import { getAdapter } from '../llm/adapters';
import { LlmError, toLlmError } from '../llm/errors';
import type { ProviderRuntime } from '../llm/types';
import { validateBaseUrl } from '../security/ssrf';
import { countActiveExperimentsUsingProvider, getConfig, updateConfig, type ProviderRecord } from '../storage/store';

export const PROVIDER_TYPES: ProviderType[] = ['openai', 'anthropic', 'gemini', 'openai_compatible', 'ollama'];

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

const untested = (): ProviderConnection => ({ status: 'untested', testedAt: null, testedModel: null, errorCategory: null, message: null });

function connectionFor(record: ProviderRecord): ProviderConnection {
  if (apiKeyRequired[record.type] && !record.encryptedApiKey) {
    return { status: 'unconfigured', testedAt: null, testedModel: null, errorCategory: 'not_configured', message: 'APIキーが登録されていません。' };
  }
  return record.connection;
}

/** フロントエンドへ返す形に変換する。暗号文・平文のAPIキーは含めない。 */
export function toDTO(record: ProviderRecord): ProviderDTO {
  const { encryptedApiKey, apiKeyHint, ...rest } = record;
  return { ...rest, hasApiKey: Boolean(encryptedApiKey), apiKeyMasked: encryptedApiKey ? apiKeyHint : null, connection: connectionFor(record) };
}

export type ProviderInput = {
  type?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  defaultModel?: unknown;
  timeoutMs?: unknown;
  maxRetries?: unknown;
  maxConcurrency?: unknown;
  monthlyBudgetUsd?: unknown;
};

function intInRange(value: unknown, field: string, label: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label}は${min}〜${max}の整数で入力してください。`, field);
  }
  return n;
}

function parseBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new ValidationError('月間API予算は0以上の数値で入力してください。', 'monthlyBudgetUsd');
  return Math.round(n * 100) / 100;
}

function parseBaseUrl(type: ProviderType, value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : defaultBaseUrls[type];
  if (!raw) throw new ValidationError('Base URL を入力してください。', 'baseUrl');
  try {
    return validateBaseUrl(raw).toString().replace(/\/+$/, '');
  } catch (e) {
    throw new ValidationError((e as Error).message, 'baseUrl');
  }
}

function parseModel(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 200 || !/^[\w.:/@+-]+$/.test(value.trim())) {
    throw new ValidationError('モデル名に使用できない文字が含まれています。', 'defaultModel');
  }
  return value.trim();
}

export async function listProviders(): Promise<ProviderDTO[]> {
  const state = await getConfig();
  return state.providers.map(toDTO);
}

export async function createProvider(input: ProviderInput): Promise<ProviderDTO> {
  if (typeof input.type !== 'string' || !PROVIDER_TYPES.includes(input.type as ProviderType)) {
    throw new ValidationError('APIプロバイダーを選択してください。', 'type');
  }
  const type = input.type as ProviderType;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 60) throw new ValidationError('表示名は1〜60文字で入力してください。', 'name');
  const now = new Date().toISOString();
  const record: ProviderRecord = {
    id: randomUUID(),
    type,
    name,
    baseUrl: parseBaseUrl(type, input.baseUrl),
    defaultModel: parseModel(input.defaultModel),
    timeoutMs: input.timeoutMs === undefined ? 60_000 : intInRange(input.timeoutMs, 'timeoutMs', 'タイムアウト（ミリ秒）', 1_000, 600_000),
    maxRetries: input.maxRetries === undefined ? 2 : intInRange(input.maxRetries, 'maxRetries', '再試行回数', 0, 10),
    maxConcurrency: input.maxConcurrency === undefined ? 4 : intInRange(input.maxConcurrency, 'maxConcurrency', '同時実行数', 1, 64),
    monthlyBudgetUsd: parseBudget(input.monthlyBudgetUsd),
    encryptedApiKey: null,
    apiKeyHint: null,
    apiKeyUpdatedAt: null,
    connection: untested(),
    models: [],
    modelsFetchedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await updateConfig((s) => {
    s.providers.push(record);
  });
  return toDTO(record);
}

export async function updateProvider(id: string, input: ProviderInput): Promise<ProviderDTO> {
  return updateConfig((s) => {
    const record = s.providers.find((p) => p.id === id);
    if (!record) throw new ValidationError('プロバイダーが見つかりません。');
    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 60) throw new ValidationError('表示名は1〜60文字で入力してください。', 'name');
      record.name = name;
    }
    if (input.baseUrl !== undefined) {
      const baseUrl = parseBaseUrl(record.type, input.baseUrl);
      if (baseUrl !== record.baseUrl) {
        record.baseUrl = baseUrl;
        // 接続先が変わったら接続状態とモデル一覧を無効にする
        record.connection = untested();
        record.models = [];
        record.modelsFetchedAt = null;
      }
    }
    if (input.defaultModel !== undefined) {
      const model = parseModel(input.defaultModel);
      if (model !== record.defaultModel) {
        record.defaultModel = model;
        record.connection = untested();
      }
    }
    if (input.timeoutMs !== undefined) record.timeoutMs = intInRange(input.timeoutMs, 'timeoutMs', 'タイムアウト（ミリ秒）', 1_000, 600_000);
    if (input.maxRetries !== undefined) record.maxRetries = intInRange(input.maxRetries, 'maxRetries', '再試行回数', 0, 10);
    if (input.maxConcurrency !== undefined) record.maxConcurrency = intInRange(input.maxConcurrency, 'maxConcurrency', '同時実行数', 1, 64);
    if (input.monthlyBudgetUsd !== undefined) record.monthlyBudgetUsd = parseBudget(input.monthlyBudgetUsd);
    record.updatedAt = new Date().toISOString();
    return toDTO(record);
  });
}

export async function deleteProvider(id: string): Promise<void> {
  if ((await countActiveExperimentsUsingProvider(id)) > 0) {
    throw new ValidationError('実行中の実験で使用されているため削除できません。実験を停止してから削除してください。');
  }
  await updateConfig((s) => {
    const before = s.providers.length;
    s.providers = s.providers.filter((p) => p.id !== id);
    if (s.providers.length === before) throw new ValidationError('プロバイダーが見つかりません。');
    for (const role of Object.values(s.roles)) {
      if (role.providerId === id) {
        role.providerId = null;
        role.model = null;
        role.updatedAt = new Date().toISOString();
      }
    }
  });
}

export async function setApiKey(id: string, apiKey: unknown): Promise<ProviderDTO> {
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 500 || /\s/.test(apiKey.trim())) {
    throw new ValidationError('APIキーの形式が正しくありません（空白を含まない8文字以上）。', 'apiKey');
  }
  const key = apiKey.trim();
  return updateConfig((s) => {
    const record = s.providers.find((p) => p.id === id);
    if (!record) throw new ValidationError('プロバイダーが見つかりません。');
    record.encryptedApiKey = encryptSecret(key, record.id);
    record.apiKeyHint = maskSecret(key);
    record.apiKeyUpdatedAt = new Date().toISOString();
    record.connection = untested();
    record.updatedAt = record.apiKeyUpdatedAt;
    return toDTO(record);
  });
}

export async function deleteApiKey(id: string): Promise<ProviderDTO> {
  return updateConfig((s) => {
    const record = s.providers.find((p) => p.id === id);
    if (!record) throw new ValidationError('プロバイダーが見つかりません。');
    record.encryptedApiKey = null;
    record.apiKeyHint = null;
    record.apiKeyUpdatedAt = new Date().toISOString();
    record.connection = untested();
    record.updatedAt = record.apiKeyUpdatedAt;
    return toDTO(record);
  });
}

export async function getProviderRecord(id: string): Promise<ProviderRecord | null> {
  const state = await getConfig();
  return state.providers.find((p) => p.id === id) ?? null;
}

/** API呼び出し用のランタイム情報。APIキーはここで初めて復号し、呼び出し元はメモリ上でのみ扱う。 */
export function runtimeFor(record: ProviderRecord): ProviderRuntime {
  if (apiKeyRequired[record.type] && !record.encryptedApiKey) {
    throw new LlmError('not_configured', `「${record.name}」のAPIキーが登録されていません。`);
  }
  let apiKey: string | null = null;
  if (record.encryptedApiKey) {
    try {
      apiKey = decryptSecret(record.encryptedApiKey, record.id);
    } catch (e) {
      throw new LlmError('not_configured', (e as Error).message);
    }
  }
  return { type: record.type, baseUrl: record.baseUrl, apiKey, timeoutMs: record.timeoutMs };
}

export async function fetchModels(id: string): Promise<ModelInfo[]> {
  const record = await getProviderRecord(id);
  if (!record) throw new ValidationError('プロバイダーが見つかりません。');
  const rt = runtimeFor(record);
  let models: ModelInfo[];
  try {
    models = await getAdapter(record.type).listModels(rt);
  } catch (e) {
    throw toLlmError(e, [rt.apiKey]);
  }
  await updateConfig((s) => {
    const r = s.providers.find((p) => p.id === id);
    if (r) {
      r.models = models;
      r.modelsFetchedAt = new Date().toISOString();
    }
  });
  return models;
}

export async function setConnection(id: string, connection: ProviderConnection): Promise<void> {
  await updateConfig((s) => {
    const r = s.providers.find((p) => p.id === id);
    if (r) r.connection = connection;
  });
}
