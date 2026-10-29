import type { RuleDefinition } from './study-types';

// 修正案（Auto-Patch）と回帰テストの共有型。

export type PatchCategory = 'regulatory_text' | 'definition' | 'retrieval' | 'prompt' | 'system_rule';

/** 状態: 実験に使う承認（approved_for_simulation）と、企業への提案として認める承認（approved_for_recommendation）を分ける */
export type PatchStatus = 'draft' | 'under_review' | 'approved_for_simulation' | 'simulation_completed' | 'approved_for_recommendation' | 'rejected' | 'archived';

export type PresentationChange = { includePurpose?: boolean; presentRules?: boolean };

export type Patch = {
  id: string;
  category: PatchCategory;
  title: string;
  /** 修正の対象の規則の版 */
  targetRuleId: string;
  targetRuleKey: string;
  before: RuleDefinition;
  /** 規則を変える修正の変更後（提示方法だけを変える修正では null） */
  after: RuleDefinition | null;
  /** 提示方法の変更（プロンプト・参照文書の修正） */
  presentation: PresentationChange | null;
  reason: string;
  relatedFingerprint: string | null;
  relatedHypothesisId: string | null;
  sourceStudyId: string;
  sourceConditionId: string;
  expectedImprovement: string;
  expectedSideEffects: string;
  /** 生成方法（このバージョンはテンプレートによる決定論的な生成のみ） */
  generator: string;
  createdAt: string;
  createdBy: string;
  status: PatchStatus;
  reviews: { from: PatchStatus; to: PatchStatus; by: string; note: string; at: string }[];
  /** 実験用に作成した規則の版（元の規則とは別の規則 ID。元の規則は変更しない） */
  sandboxRuleId: string | null;
  experimentStudyId: string | null;
  isMock: boolean;
};

export type GateThresholds = {
  /** 修正後の誤拒否率（正常な行動）の 95% 上限 */
  maxFalseRejectionRate: number;
  /** 既知の Failure を防げた割合（修正後）の 95% 下限 */
  minPreventionRate: number;
  /** 修正済みケースの成功率（再発がないこと） */
  minPreviouslyFixedPassRate: number;
  /** データセットごとの最小件数（未満なら判断保留） */
  minCasesPerDataset: number;
  /** 再実験で許容する追加費用（USD、null は制限なし） */
  maxAddedCostUsd: number | null;
};

export type GateResult = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'REVIEW_REQUIRED';

export type RateWithCi = { k: number; n: number; p: number | null; ci: [number, number] | null };

export type CaseOutcome = {
  testCaseId: string;
  dataset: string;
  status: string;
  title: string;
  before: { verdict: string; codes: string[]; deviations: string[] };
  after: { verdict: string; codes: string[]; deviations: string[] };
  /** 期待との照合（既知の Failure・閾値付近 = 防げたか、正常 = 受理されたか） */
  passBefore: boolean;
  passAfter: boolean;
  /** 規則の対象外（修正の対象の規則を使っていないケース） */
  applicable: boolean;
};

export type RegressionRun = {
  id: string;
  patchId: string;
  createdAt: string;
  createdBy: string;
  thresholds: GateThresholds;
  includeCandidates: boolean;
  outcomes: CaseOutcome[];
  metrics: {
    prevention: { before: RateWithCi; after: RateWithCi };
    falseRejection: { before: RateWithCi; after: RateWithCi };
    previouslyFixed: { after: RateWithCi };
    /** 修正後に新たに拒否されるようになった正常ケース・新たに見逃すようになった既知ケース */
    newFailures: number;
    notApplicable: number;
    riskReduction: number | null;
    falseRejectionIncrease: number | null;
  };
  /** 再実験（同じ市場・同じシードの行動の比較）の結果。実行していなければ null */
  experiment: {
    studyId: string;
    isMock: boolean;
    violationRate: { control: number | null; treatment: number | null };
    meanPnl: { control: number | null; treatment: number | null };
    costUsd: { control: number; treatment: number };
    meanSessionSeconds: { control: number | null; treatment: number | null };
    failedSessions: { control: number; treatment: number };
  } | null;
  gate: GateResult;
  gateReasons: string[];
  engineVersion: string;
};
