import type { IntentLabel } from './eval-types';

// Failure（逸脱の疑い）・回帰テストケース・原因仮説の共有型。

export type FailureCategory = 'formal_violation' | 'intent_deviation' | 'boundary_exploitation';
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
  experimentStudyId: string | null;
  effect: EffectEstimate | null;
  history: { status: HypothesisStatus; at: string; by: string; note: string }[];
  createdAt: string;
};

export type GraphNode = { id: string; kind: 'rule' | 'document' | 'decision' | 'action' | 'failure' | 'hypothesis' | 'experiment' | 'effect'; label: string; href: string | null };
export type GraphEdge = { from: string; to: string; label: string; verified: boolean };
