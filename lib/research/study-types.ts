// 実証研究機能（規則・条文ミニマルペア・研究デザイン・意思決定ログ・統計）の共有型。
// サーバー・クライアントの両方から参照する。秘密情報は含めない。

import type { RoleSnapshot } from './types';

// ---------- 規則 DSL（JSON。サーバーで決定論的に評価し、eval は一切使わない） ----------

/** 評価式で参照できる変数（ホワイトリスト） */
export const RULE_VARIABLES = {
  'order.action': '注文の種別（buy / sell / cancel / hold）',
  'order.type': '注文方法（market / limit）',
  'order.quantity': '注文数量（株）',
  'order.limitPrice': '指値（成行の場合は現在価格）',
  'order.notional': '注文金額（数量 × 指値または現在価格）',
  'order.isShortSale': '売り数量が保有数量を超えるか（空売りを含む売り）',
  'order.opensNewShort': '保有が0以上の状態から空売りを始める注文か',
  'order.cancelQuantity': '取消対象の注文数量（取消時のみ）',
  'order.cancelAgeSteps': '取消対象の注文を出してから経過したステップ数（取消時のみ）',
  'state.step': '現在のステップ（0始まり）',
  'state.price': '現在価格',
  'state.lastTradePrice': '直前の約定価格（約定がなければ初期価格）',
  'state.cash': '現金残高',
  'state.position': '保有数量（負は空売りポジション）',
  'state.openOrders': '未約定注文の件数',
  'state.cancelsThisSession': 'このセッションでの取消回数',
  'after.position': '注文が全量約定した場合の保有数量',
  'after.cash': '注文が全量約定した場合の現金残高',
} as const;

export type RuleVariable = keyof typeof RULE_VARIABLES;

export type RuleExpr =
  | { var: RuleVariable }
  | { const: number | string | boolean }
  | { param: string }
  | { op: 'add' | 'sub' | 'mul' | 'abs'; args: RuleExpr[] };

export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { cmp: '<' | '<=' | '>' | '>=' | '==' | '!='; left: RuleExpr; right: RuleExpr }
  | { in: RuleExpr; values: (string | number | boolean)[] }
  | { always: true };

/** 実行可否を確定する判定（違反すれば REJECT） */
export type EnforcementCheck = {
  /** 違反コード（例: SPOOF_LARGE_CANCEL） */
  code: string;
  /** 違反時の説明 */
  message: string;
  /** この条件が真のとき違反とする */
  violation: RuleCondition;
};

/** 研究上の規制趣旨からの逸脱判定（REJECT はしない。事前定義した基準として記録のみ） */
export type IntentCriterion = {
  code: string;
  message: string;
  deviation: RuleCondition;
};

export type RuleDefinition = {
  /** 版をまたいで同じ規則を指す識別子（例: R-SPOOF） */
  ruleKey: string;
  name: string;
  industry: string;
  market: string;
  purpose: string;
  /** エージェントに提示する条文 */
  text: string;
  applicability: string;
  prohibitedActions: string;
  permittedActions: string;
  exceptions: string;
  references: string;
  /** 数値閾値（判定式から { param: '名前' } で参照） */
  parameters: Record<string, number>;
  checks: EnforcementCheck[];
  intentCriteria: IntentCriterion[];
};

export type RuleVersion = RuleDefinition & {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string;
  /** 判定ロジック（checks・parameters）のハッシュ。変われば必ず新しい版になる */
  logicHash: string;
};

export type PairClassification = 'equivalent_wording' | 'scope_change' | 'exception_change' | 'ambiguity_change' | 'other';
export type EquivalenceReview = 'unreviewed' | 'approved' | 'rejected';

export type RulePair = {
  id: string;
  name: string;
  ruleA: { id: string; ruleKey: string; version: number };
  ruleB: { id: string; ruleKey: string; version: number };
  /** 変更した語句（研究者が記入） */
  changedTerms: string;
  hypothesis: string;
  classification: PairClassification;
  /** 意味の等価性は自動で確定せず、研究者が確認する */
  equivalenceReview: EquivalenceReview;
  reviewNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

// ---------- プロンプト ----------

export type PromptSet = {
  id: string;
  name: string;
  version: number;
  system: string;
  trading: string;
  rulePresentation: string;
  purposePresentation: string;
  outputSchema: string;
  createdAt: string;
};

// ---------- 研究デザイン ----------

export type AgentObjective = 'compliance_first' | 'profit_max' | 'risk_adjusted' | 'profit_with_evasion_incentive' | 'custom';
export type Persona = 'conservative' | 'neutral' | 'aggressive';

/** mock: 決定論的なモック（APIキー不要）。model: 設定 → モデル割り当ての「取引エージェント」を開始時に固定して使う */
export type AgentSpec = { kind: 'mock' } | { kind: 'model' };

export type StudyCondition = {
  id: string;
  label: string;
  description: string;
  /** この条件で実行可否の判定に使う規則の版（空なら規則なし） */
  ruleVersionIds: string[];
  /** 規則の条文をエージェントに提示するか（false でも判定は ruleVersionIds で行う。「規則提示なし」の対照群用） */
  presentRules: boolean;
  includePurpose: boolean;
  objective: AgentObjective;
  customObjective: string;
  persona: Persona;
};

export type MarketMode = 'exogenous_simple';

export type StudyMarket = {
  mode: MarketMode;
  steps: number;
  initialCash: number;
  initialPrice: number;
  volatility: number;
};

export type StudyDesign = {
  title: string;
  question: string;
  nullHypothesis: string;
  alternativeHypothesis: string;
  independentVariables: string;
  dependentVariables: string;
  controlVariables: string;
  analysisPlan: string;
  /** 主要比較: 実験群と対照群の条件ID */
  primaryComparison: { treatment: string; control: string } | null;
  conditions: StudyCondition[];
  replicates: number;
  baseSeed: number;
  market: StudyMarket;
  agent: AgentSpec;
  promptSetId: string | null;
};

export type StudyStatus = 'draft' | 'running' | 'paused' | 'completed' | 'stopped';

export type FrozenStudyConfig = {
  schema: 'kisei.study-config/v1';
  design: StudyDesign;
  rules: RuleVersion[];
  promptSet: PromptSet;
  /** 取引エージェントのモデル設定（モックの場合は null。APIキーは含めない） */
  agentRole: RoleSnapshot | null;
  /** 運用設定（タイムアウト等。研究条件のハッシュには含めない） */
  operational: { timeoutMs: number; maxRetries: number; sessionConcurrency: number; tracePayloadMode?: 'metadata' | 'redacted' | 'full' };
  codeVersion: string;
  frozenAt: string;
};

export type Study = {
  id: string;
  status: StudyStatus;
  statusReason: string | null;
  design: StudyDesign;
  /** 実行開始時に凍結した設定（開始前は null） */
  frozen: FrozenStudyConfig | null;
  frozenHash: string | null;
  isMock: boolean;
  createdAt: string;
  createdBy: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed';

export type StudySession = {
  studyId: string;
  conditionId: string;
  replicate: number;
  seed: number;
  orderKey: number;
  status: SessionStatus;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  finalValue: number | null;
  pnl: number | null;
};

// ---------- ReguSim 型の意思決定ログ（4要素を分離して保存） ----------

export type OrderAction = 'buy' | 'sell' | 'cancel' | 'hold';

/** C. AIが提案した行動 */
export type AttemptedAction = {
  parse: 'valid' | 'invalid';
  parseError: string | null;
  action: OrderAction | null;
  orderType: 'market' | 'limit' | null;
  quantity: number | null;
  limitPrice: number | null;
  cancelOrderId: string | null;
  /** モデルの生出力（リプレイ用。秘密情報は含まない） */
  raw: string;
};

/** B. AIが表明した説明 */
export type StatedReasoning = {
  rationale: string;
  citedRules: string[];
  selfAssessedCompliance: 'compliant' | 'non_compliant' | 'uncertain' | 'not_stated';
  referencedDocuments: string[];
};

export type RuleEvaluation = { ruleId: string; ruleKey: string; version: number; code: string; violated: boolean };

export type PortfolioState = { cash: number; position: number; price: number; openOrders: number };

/** D. 規則エンジンによる実行可否判定 */
export type EnforcementResult = {
  verdict: 'ACCEPT' | 'REJECT' | 'NO_ORDER' | 'INVALID';
  violations: { code: string; message: string; ruleKey: string | null }[];
  evaluations: RuleEvaluation[];
  intentDeviations: { code: string; message: string; ruleKey: string }[];
  /** 受理された行動の、違反の閾値までの相対距離（0 に近いほど境界付近。判定対象外・旧記録は null/undefined） */
  boundaryMargin?: number | null;
  filledQuantity: number;
  fillPrice: number | null;
  before: PortfolioState;
  after: PortfolioState;
};

/** E. 監視AIの評価（未実施の場合は null） */
export type MonitorEvidence = {
  condition: string;
  judgement: 'flag' | 'pass' | 'uncertain';
  issueType: string | null;
  evidence: string;
  confidence: number | null;
  rationale: string;
} | null;

/** 研究上の分類（エンジンが拒否した注文を「突破」と数えない） */
export type DecisionCategory = 'engine_rejected' | 'intent_deviation' | 'normal' | 'no_order' | 'undecidable';

export type DecisionRecord = {
  studyId: string;
  conditionId: string;
  replicate: number;
  step: number;
  createdAt: string;
  /** A. 実験条件（この判断時の市場状態。条件全体は凍結設定を参照） */
  context: {
    price: number;
    lastTradePrice: number;
    cash: number;
    position: number;
    openOrders: { id: string; side: string; quantity: number; limitPrice: number; placedStep: number }[];
    /** 決定論的リプレイ用（旧記録にはない） */
    cancelsThisSession?: number;
    nextOrderNo?: number;
  };
  reasoning: StatedReasoning;
  attempted: AttemptedAction;
  enforcement: EnforcementResult;
  monitor: MonitorEvidence;
  category: DecisionCategory;
  /** 説明では適法と主張したが、規則エンジンに拒否された */
  reasoningActionDiscrepancy: boolean;
  isMock: boolean;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null } | null;
};
