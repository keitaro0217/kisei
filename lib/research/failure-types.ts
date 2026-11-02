import type { IntentLabel } from './eval-types';

// Failure（逸脱の疑い）・回帰テストケース・原因仮説の共有型。

export type FailureCategory =
  | 'formal_violation'
  | 'intent_deviation'
  | 'boundary_exploitation'
  /** 統計的に外れた行動（同じ条件の他の行動と比べて極端な数量など）。違反の判定ではない */
  | 'anomalous_behavior'
  /** 評価器の間で趣旨の判定が割れた（人の確認が必要） */
  | 'evaluation_disagreement'
  /** 行動を解釈できず評価できなかった */
  | 'unevaluable'
  /** 不適切なツールの使用（ツールのある評価環境のみ。金融市場シミュレーションにはツールがないため検出しない） */
  | 'inappropriate_tool_use'
  /** 権限外の情報の利用（情報のアクセス制御のある評価環境のみ。現在の環境では検出しない） */
  | 'unauthorized_information_use';

/** 検出の確信度（重大度とは別。high = 決定論的な判定、medium = 複数の評価器が一致、low = 単一の確率的な評価・統計的な外れ値・評価の不一致） */
export type FailureConfidence = 'high' | 'medium' | 'low';
export type FailureSeverity = 'low' | 'medium' | 'high';
export type FailureStatus = 'new' | 'confirmed' | 'dismissed';

export type Failure = {
  id: string;
  studyId: string;
  conditionId: string;
  replicate: number;
  step: number;
  traceId: string | null;
  category: FailureCategory;
  /** どの層・評価器で検出したか */
  detectedBy: ('engine' | 'criteria' | 'judge' | 'human')[];
  ruleKeys: string[];
  ruleVersionIds: string[];
  codes: string[];
  action: { action: string | null; orderType: string | null; quantity: number | null; limitPrice: number | null };
  market: { price: number; lastTradePrice: number; position: number; cash: number; trend: 'up' | 'down' | 'flat' };
  boundaryMargin: number | null;
  model: string;
  /** 評価器の版（規則エンジン・判定に使った Judge のプロンプト） */
  graderVersions: string[];
  /** 重大度は機械的な初期値（形式違反 = high、趣旨逸脱 = medium、閾値付近 = low）。人が確認して変更できる */
  severity: FailureSeverity;
  /** 検出の確信度（Phase 2 以降。以前の記録にはない） */
  confidence?: FailureConfidence;
  /** 検出に使った評価器の ID と、複合評価の集約ロジックの版（Phase 2 以降） */
  evaluators?: string[];
  evaluationVersion?: string;
  /** 再現に必要な情報（Phase 2 以降） */
  replay?: { seed: number | null; frozenHash: string | null; traceAvailable: boolean; note: string };
  status: FailureStatus;
  /** 形式判定は記録した状態から決定論的に再現できる。行動そのものはモデルの確率性のため再現が保証されない */
  reproducibility: 'formal_replay_deterministic';
  agentReproducible: boolean;
  fingerprint: string;
  isMock: boolean;
  createdAt: string;
  reviewNote: string;
};

export type FailureCluster = {
  fingerprint: string;
  label: string;
  category: FailureCategory;
  ruleKeys: string[];
  codes: string[];
  actionType: string;
  quantityBand: string;
  trend: string;
  positionSide: string;
  count: number;
  studies: number;
  severity: FailureSeverity;
  confirmed: number;
  dismissed: number;
  firstSeen: string;
  lastSeen: string;
  /** 以前の研究ですでに見つかっているか（最初に見つかった研究以外では「既知」） */
  known: boolean;
  testCases: number;
  hypotheses: number;
  /** Phase 2: 検索・比較用の属性 */
  industries?: string[];
  models?: string[];
  causes?: CauseCategory[];
  /** 修正の状況: none = 修正案なし、proposed = 修正案あり、approved = 実験用に承認、recommended = 提案として承認 */
  fixStatus?: 'none' | 'proposed' | 'approved' | 'recommended';
  /** 検証の結果: 回帰テストの最新の判定、または仮説の検証結果 */
  verification?: 'not_verified' | 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'REVIEW_REQUIRED' | 'hypothesis_supported' | 'hypothesis_refuted';
  confidence?: FailureConfidence;
};

export type FailureLibraryFilter = {
  q?: string;
  ruleKey?: string;
  industry?: string;
  category?: FailureCategory;
  cause?: CauseCategory;
  model?: string;
  severity?: FailureSeverity;
  fixStatus?: NonNullable<FailureCluster['fixStatus']>;
  verification?: NonNullable<FailureCluster['verification']>;
};

export type TestDataset = 'known_failure' | 'normal_behavior' | 'boundary' | 'previously_fixed';
export type TestCaseStatus = 'candidate' | 'approved' | 'rejected';

export type TestCase = {
  id: string;
  sourceKey: string;
  fingerprint: string | null;
  dataset: TestDataset;
  status: TestCaseStatus;
  title: string;
  /** 再現条件: 判断の時点の状態（取引所の状態を復元できる） */
  initialState: {
    price: number;
    lastTradePrice: number;
    cash: number;
    position: number;
    step: number;
    openOrders: { id: string; side: string; quantity: number; limitPrice: number; placedStep: number }[];
    cancelsThisSession: number;
    nextOrderNo: number;
  };
  /** 判定に使った規則の版（凍結時点） */
  ruleVersionIds: string[];
  agent: { model: string; conditionId: string; studyId: string };
  action: { parse: 'valid' | 'invalid'; action: string | null; orderType: string | null; quantity: number | null; limitPrice: number | null; cancelOrderId: string | null };
  /** 期待される形式判定（検出時の規則エンジンの判定） */
  expectedFormal: { verdict: string; ruleViolation: boolean; codes: string[] };
  /** 期待される趣旨の判定（人が確認して確定する。AI の推測だけでは確定しない） */
  expectedIntent: IntentLabel | null;
  evidenceKeys: string[];
  reproducibility: 'formal_replay_deterministic';
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string;
};

export type HypothesisStatus =
  | 'HYPOTHESIS'
  | 'SUPPORTED_BY_TRACE'
  | 'EXPERIMENT_SCHEDULED'
  | 'EXPERIMENT_TESTED'
  | 'EVIDENCE_SUPPORTS_EFFECT'
  | 'EVIDENCE_INCONCLUSIVE'
  | 'EVIDENCE_AGAINST_EFFECT';

export type HypothesisFactor =
  | 'conjunction'
  | 'qualifier'
  | 'purpose_not_presented'
  | 'rules_not_presented'
  | 'objective_incentive'
  | 'threshold'
  | 'evaluator_error'
  | 'exception_clause';

/**
 * 原因候補の分類（Phase 2）。要因（factor）を、規則・提示・環境・評価器のどこにあるかで分類する。
 * rag_retrieval / access_control / tool_permission は、それぞれの仕組みを持つ評価環境でのみ生成する（現在の金融市場シミュレーションにはない）。
 */
export type CauseCategory =
  | 'rule_ambiguity'
  | 'conjunction_qualifier'
  | 'exception_clause'
  | 'objective_function'
  | 'prompt'
  | 'reference_document'
  | 'rag_retrieval'
  | 'access_control'
  | 'tool_permission'
  | 'simulation_environment'
  | 'evaluator_error';

export type Intervention =
  | { kind: 'swap_rule'; fromRuleId: string; toRuleId: string; description: string }
  | { kind: 'include_purpose'; description: string }
  | { kind: 'present_rules'; description: string }
  | { kind: 'change_objective'; to: 'compliance_first'; description: string }
  | { kind: 'none'; description: string };

export type EffectEstimate = {
  metric: 'failure_rate';
  treatment: string;
  control: string;
  treatmentRate: number | null;
  controlRate: number | null;
  /** 処置 − 対照（負なら介入で Failure が減った） */
  diff: number | null;
  ci: [number, number] | null;
  pairedReplicates: number;
  permutationP: number | null;
  isMock: boolean;
  /** 解釈上の注意（判定規則そのものが変わる介入、モックデータなど） */
  caveats: string[];
  computedAt: string;
};

export type Hypothesis = {
  id: string;
  fingerprint: string;
  sourceStudyId: string;
  conditionId: string;
  factor: HypothesisFactor;
  title: string;
  description: string;
  /** 根拠（トレース・判断）。トレースでの裏付けは因果の証明ではない */
  evidence: { failureCount: number; exampleKeys: string[]; traceIds: string[]; note: string };
  intervention: Intervention;
  /** 介入で変わる要因（原則1つ。複数の場合は解釈に注意） */
  changedFactors: string[];
  status: HypothesisStatus;
  /** 原因候補の分類（Phase 2 以降） */
  cause?: CauseCategory;
  /** 反証条件: この結果が出たら仮説は支持されない（実験の前に固定する） */
  falsification?: string;
  /** 仮説の検証に必要な比較実験 */
  requiredExperiment?: string;
  /** 検証の結果（比較実験の後）。supported でも「この条件・この標本で効果が観察された」ことを示すだけで、一般的な因果の立証ではない */
  verification?: { result: 'supported' | 'refuted' | 'inconclusive'; summary: string; studyId: string; at: string } | null;
  experimentStudyId: string | null;
  effect: EffectEstimate | null;
  history: { status: HypothesisStatus; at: string; by: string; note: string }[];
  createdAt: string;
};

export type GraphNode = { id: string; kind: 'rule' | 'document' | 'decision' | 'action' | 'failure' | 'hypothesis' | 'experiment' | 'effect'; label: string; href: string | null };
export type GraphEdge = { from: string; to: string; label: string; verified: boolean };
