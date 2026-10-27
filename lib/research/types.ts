// 研究システム（API連携・実験管理）でサーバーとクライアントが共有する型定義。
// APIキーなどの秘密情報を含む型はここに置かない（サーバー専用の lib/server 配下で扱う）。

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'openai_compatible' | 'ollama';

export type ConnectionStatus = 'connected' | 'failed' | 'unconfigured' | 'untested';

export type LlmErrorCategory =
  | 'not_configured'
  | 'auth'
  | 'permission'
  | 'model_unavailable'
  | 'rate_limit'
  | 'quota'
  | 'budget_exceeded'
  | 'network'
  | 'timeout'
  | 'ssrf_blocked'
  | 'invalid_request'
  | 'server_error'
  | 'refusal'
  | 'invalid_response'
  | 'provider_changed'
  | 'unknown';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** モデルごとに送信する推論設定。プロバイダーが対応しない項目は送信しない。 */
export type ReasoningSettings = {
  /** OpenAI / Anthropic / OpenAI互換: 推論の深さ */
  effort?: ReasoningEffort | null;
  /** Gemini: 思考トークン予算（-1 = 自動, 0 = 無効） */
  thinkingBudget?: number | null;
};

export type ProviderConnection = {
  status: ConnectionStatus;
  testedAt: string | null;
  testedModel: string | null;
  errorCategory: LlmErrorCategory | null;
  message: string | null;
};

/** フロントエンドへ返すプロバイダー情報。APIキー本体は含めない。 */
export type ProviderDTO = {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  defaultModel: string | null;
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  monthlyBudgetUsd: number | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  apiKeyUpdatedAt: string | null;
  connection: ProviderConnection;
  models: ModelInfo[];
  modelsFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelInfo = {
  id: string;
  displayName: string | null;
  maxOutputTokens: number | null;
  /** プロバイダーのAPIが返した推論関連の対応状況（取得できない場合は null） */
  supportsReasoning: boolean | null;
};

export type ResearchRole = 'trading_agent' | 'llm_judge' | 'auto_patch' | 'document_analysis';

export type RoleAssignment = {
  role: ResearchRole;
  providerId: string | null;
  model: string | null;
  reasoning: ReasoningSettings;
  maxOutputTokens: number;
  updatedAt: string | null;
};

export type BasicSettings = {
  appDisplayName: string;
  language: 'ja';
  timeZone: string;
  dateFormat: 'yyyy/MM/dd HH:mm' | 'yyyy-MM-dd HH:mm' | 'MM/dd HH:mm';
};

export type ExecutionSettings = {
  /** 1つの実験で並列実行するエピソード数 */
  episodeConcurrency: number;
  /** エピソードが一時的な障害で失敗した場合の再試行回数 */
  episodeRetries: number;
  /** 連続失敗がこの件数に達したら実験を一時停止する */
  maxConsecutiveFailures: number;
};

export type CostSettings = {
  /** 全プロバイダー合計の月間予算（USD）。null は上限なし */
  globalMonthlyBudgetUsd: number | null;
};

export type AppSettings = {
  basic: BasicSettings;
  execution: ExecutionSettings;
  cost: CostSettings;
};

/** 管理者が入力するモデル単価（USD / 100万トークン） */
export type ModelPrice = {
  providerId: string;
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok: number | null;
  cacheWritePerMTok: number | null;
  /** 単価の出典（料金表URLやメモ）。推測値と区別するため必須 */
  source: string;
  updatedAt: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  /** 取得できない場合は null */
  reasoningTokens: number | null;
};

export type UsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** 単価が設定された呼び出しのみの合計（USD） */
  costUsd: number;
  /** 単価未設定のため費用を計算できなかった呼び出し数 */
  unpricedCalls: number;
};

export type UsageRecord = {
  id: string;
  at: string;
  providerId: string;
  providerType: ProviderType;
  model: string;
  role: ResearchRole | 'connection_test' | 'simulation';
  experimentId: string | null;
  episodeIndex: number | null;
  usage: TokenUsage;
  costUsd: number | null;
  priceSource: string | null;
  ok: boolean;
  errorCategory: LlmErrorCategory | null;
};

export type ExperimentStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'failed';

export type MarketRules = {
  maxOrderQuantity: number;
  maxPosition: number;
  allowShortSelling: boolean;
};

export type MarketConfig = {
  steps: number;
  initialCash: number;
  initialPrice: number;
  volatility: number;
  rules: MarketRules;
};

/** 実験開始時に固定するモデル設定（APIキーは含めない） */
export type RoleSnapshot = {
  providerId: string;
  providerType: ProviderType;
  providerName: string;
  baseUrl: string;
  model: string;
  reasoning: ReasoningSettings;
  maxOutputTokens: number;
};

export type ExperimentSnapshot = {
  roles: { trading_agent: RoleSnapshot; llm_judge: RoleSnapshot | null };
  prompts: { tradingAgentSystem: string; judgeSystem: string; promptVersion: string };
  tools: { decisionFormat: string; toolVersion: string };
  market: MarketConfig;
  ruleDocument: string;
  /** 運用設定（研究条件ではないためバージョンハッシュには含めない） */
  operational: { timeoutMs: number; maxRetries: number; episodeConcurrency: number; episodeRetries: number; maxConsecutiveFailures: number };
};

export type Experiment = {
  id: string;
  name: string;
  description: string;
  status: ExperimentStatus;
  statusReason: string | null;
  statusCategory: LlmErrorCategory | null;
  episodes: number;
  seed: number;
  judgeEnabled: boolean;
  snapshot: ExperimentSnapshot;
  versionHash: string;
  versionLabel: string;
  completedEpisodes: number;
  failedEpisodes: number;
  usage: UsageTotals;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type ExperimentVersion = {
  hash: string;
  label: string;
  createdAt: string;
  summary: string;
};

export type TradeDecision = {
  step: number;
  price: number;
  action: 'buy' | 'sell' | 'hold';
  quantity: number;
  executed: boolean;
  violations: string[];
  referencedRules: number[];
  rationale: string;
  parseError: string | null;
};

export type JudgeResult = {
  score: number | null;
  summary: string;
  issues: string[];
  parseError: string | null;
};

export type EpisodeResult = {
  index: number;
  seed: number;
  status: 'completed' | 'failed';
  error: { category: LlmErrorCategory; message: string } | null;
  finalValue: number | null;
  pnl: number | null;
  violationCount: number;
  decisions: TradeDecision[];
  judge: JudgeResult | null;
  usage: UsageTotals;
  attempts: number;
  startedAt: string;
  finishedAt: string;
};

export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  result: 'success' | 'failure';
  detail: string | null;
};

export type ConnectionTestStep = {
  key: 'api_key' | 'network' | 'model' | 'inference';
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  message: string | null;
};

export type ConnectionTestResult = {
  ok: boolean;
  model: string | null;
  steps: ConnectionTestStep[];
  errorCategory: LlmErrorCategory | null;
  message: string | null;
  latencyMs: number | null;
};

export type SecurityStatus = {
  basicAuth: { enabled: boolean; mode: 'enforced' | 'disabled_dev'; httpsEnforced: boolean };
  encryption: { configured: boolean; algorithm: string };
  providers: { id: string; name: string; hasApiKey: boolean; apiKeyUpdatedAt: string | null }[];
  egressProxy: boolean;
  allowedPrivateHosts: string[];
};
