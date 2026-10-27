import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../env';
import type {
  AppSettings,
  Experiment,
  ExperimentVersion,
  ModelPrice,
  ProviderDTO,
  ResearchRole,
  RoleAssignment,
  UsageTotals,
} from '@/lib/research/types';

// サーバー側のデータ保存。依存を増やさないため JSON ファイルで永続化する。
// 書き込みは直列化し、一時ファイル→rename で原子的に置き換える。
// 将来 RDB へ移行する場合は、このモジュールのインターフェースを保ったまま差し替える。

export type ProviderRecord = Omit<ProviderDTO, 'hasApiKey' | 'apiKeyMasked'> & {
  /** AES-256-GCM で暗号化したAPIキー。平文は保存しない */
  encryptedApiKey: string | null;
  apiKeyHint: string | null;
};

export type State = {
  version: 1;
  settings: AppSettings;
  providers: ProviderRecord[];
  roles: Record<ResearchRole, RoleAssignment>;
  prices: ModelPrice[];
  experiments: Experiment[];
  experimentVersions: ExperimentVersion[];
  /** 月（YYYY-MM）→ プロバイダーID → 集計 */
  usageMonthly: Record<string, Record<string, UsageTotals>>;
};

export const emptyTotals = (): UsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  unpricedCalls: 0,
});

const defaultRole = (role: ResearchRole): RoleAssignment => ({
  role,
  providerId: null,
  model: null,
  reasoning: {},
  maxOutputTokens: role === 'trading_agent' ? 1024 : 2048,
  updatedAt: null,
});

export function initialState(): State {
  return {
    version: 1,
    settings: {
      basic: { appDisplayName: '規制解釈AI 研究コンソール', language: 'ja', timeZone: 'Asia/Tokyo', dateFormat: 'yyyy/MM/dd HH:mm' },
      execution: { episodeConcurrency: 4, episodeRetries: 2, maxConsecutiveFailures: 5 },
      cost: { globalMonthlyBudgetUsd: null },
    },
    providers: [],
    roles: {
      trading_agent: defaultRole('trading_agent'),
      llm_judge: defaultRole('llm_judge'),
      auto_patch: defaultRole('auto_patch'),
      document_analysis: defaultRole('document_analysis'),
    },
    prices: [],
    experiments: [],
    experimentVersions: [],
    usageMonthly: {},
  };
}

type StoreGlobal = {
  state: State | null;
  loading: Promise<State> | null;
  queue: Promise<unknown>;
};

const g = globalThis as typeof globalThis & { __researchStore?: StoreGlobal };
const store: StoreGlobal = (g.__researchStore ??= { state: null, loading: null, queue: Promise.resolve() });

export const dataPath = (...parts: string[]) => path.resolve(process.cwd(), getDataDir(), ...parts);

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function load(): Promise<State> {
  const file = dataPath('state.json');
  let state: State;
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<State>;
    const base = initialState();
    state = {
      ...base,
      ...parsed,
      settings: {
        basic: { ...base.settings.basic, ...parsed.settings?.basic },
        execution: { ...base.settings.execution, ...parsed.settings?.execution },
        cost: { ...base.settings.cost, ...parsed.settings?.cost },
      },
      roles: { ...base.roles, ...parsed.roles },
    } as State;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('研究データファイルを読み込めませんでした。');
    state = initialState();
  }
  // サーバー再起動時、実行中だった実験は研究条件を保持したまま一時停止扱いにする
  const now = new Date().toISOString();
  for (const exp of state.experiments) {
    if (exp.status === 'running' || exp.status === 'queued' || exp.status === 'pausing') {
      exp.status = 'paused';
      exp.statusReason = 'サーバー再起動により一時停止しました。再開できます。';
      exp.updatedAt = now;
    } else if (exp.status === 'stopping') {
      exp.status = 'stopped';
      exp.updatedAt = now;
    }
  }
  return state;
}

export async function getState(): Promise<State> {
  if (store.state) return store.state;
  store.loading ??= load().then((s) => {
    store.state = s;
    return s;
  });
  return store.loading;
}

async function persist(state: State) {
  const file = dataPath('state.json');
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** 状態を排他的に更新して保存する。fn 内で state を直接変更する。 */
export function updateState<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
  const run = store.queue.then(async () => {
    const state = await getState();
    const result = await fn(state);
    await persist(state);
    return result;
  });
  store.queue = run.catch(() => undefined);
  return run;
}

export async function appendJsonl(relative: string, record: unknown): Promise<void> {
  const file = dataPath(relative);
  await ensureDir(path.dirname(file));
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export async function readJsonl<T>(relative: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(dataPath(relative), 'utf8');
    const out: T[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // 書き込み途中で中断された行は無視する
      }
    }
    return out;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** テスト用: メモリ上の状態を破棄する */
export function resetStoreForTests() {
  store.state = null;
  store.loading = null;
  store.queue = Promise.resolve();
}
