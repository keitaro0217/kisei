import type { RoleSnapshot } from './types';

// 多層評価（形式適合・規制趣旨・経済/業務影響・証拠の質・評価器の信頼性）の共有型。

/** 規制趣旨についての判定 */
export type IntentLabel = 'aligned' | 'deviation_suspected' | 'uncertain';

/** 判断ごとの最終表示（形式と趣旨は別々に保持し、ここでは表示用にまとめる） */
export type FinalAssessment =
  | 'formal_ok_intent_ok'
  | 'formal_ok_intent_deviation'
  | 'formal_violation'
  | 'insufficient_evidence'
  | 'evaluation_failed'
  | 'pending_human';

/** Judge に渡す証拠（ID は判断内で一意。Judge はこの ID だけを引用できる） */
export type EvidenceItem = { id: string; kind: 'market' | 'action' | 'enforcement' | 'rule' | 'purpose' | 'rationale'; label: string; content: string };

export type JudgeVerdict = {
  intent: IntentLabel | null;
  rationale: string;
  evidenceIds: string[];
  /** 引用された ID のうち、渡した証拠に存在しないもの */
  invalidEvidenceIds: string[];
  /** Judge の自己申告の不確実性（統計的に校正された確率ではない） */
  uncertainty: 'low' | 'medium' | 'high' | null;
  /** JSON として解釈できない、または必須項目・型が不正な場合のエラー */
  schemaErrors: string[];
  raw: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null } | null;
  at: string;
};

export type JudgeKind = 'mock' | 'model';

export type EvalRunStatus = 'running' | 'completed' | 'paused' | 'failed';

export type EvalRun = {
  id: string;
  studyId: string;
  name: string;
  kind: JudgeKind;
  /** モデルの Judge の設定（開始時に固定。APIキーは含めない） */
  judgeRole: RoleSnapshot | null;
  promptVersion: string;
  promptHash: string;
  /** 評価対象の判断（標本）。キーは「条件ID/反復/ステップ」 */
  sample: string[];
  sampleStrategy: 'all_flagged_then_random' | 'random';
  sampleSeed: number;
  status: EvalRunStatus;
  statusReason: string | null;
  completed: number;
  failed: number;
  createdAt: string;
  createdBy: string;
  finishedAt: string | null;
  leaseOwner?: string | null;
  leaseUntil?: string | null;
};

export type Annotation = {
  studyId: string;
  conditionId: string;
  replicate: number;
  step: number;
  /** 評価者（共有ログインのため、評価者が入力した名前で区別する） */
  annotator: string;
  intent: IntentLabel;
  /** 規則エンジンの形式判定が正しいと評価者が判断したか（null = 未評価） */
  formalCorrect: boolean | null;
  reason: string;
  /** AI Judge の判定を修正した場合、その Judge の評価 ID */
  correctsRunId: string | null;
  updatedAt: string;
  history: { intent: IntentLabel; formalCorrect: boolean | null; reason: string; at: string }[];
};

export type AgreementStats = {
  n: number;
  /** 完全一致率 */
  agreement: number | null;
  /** Cohen の κ（3値: aligned / deviation_suspected / uncertain） */
  kappa: number | null;
  /** 「趣旨逸脱の疑い」を陽性とした Precision / Recall / F1（基準側を正解とする） */
  precision: number | null;
  recall: number | null;
  f1: number | null;
};

export type LayerSummary = {
  conditionId: string;
  label: string;
  decisions: number;
  final: Record<FinalAssessment, number>;
  formal: { attempts: number; ruleViolations: number; systemRejections: number };
  intent: { criteriaDeviations: number; judgeEvaluated: number; judgeDeviations: number; judgeUncertain: number; humanEvaluated: number; humanDeviations: number };
  economic: {
    meanPnl: number | null;
    /** 主要比較の対照群との、反復ごとの損益の差の平均（対照群自身は null） */
    excessPnlVsControl: number | null;
    /** 受理された注文のうち、規則の閾値付近（相対距離 10% 以内）の割合 */
    boundaryConcentration: number | null;
    /** 拒否された注文のうち、人の評価で「趣旨に適合」とされた割合（誤拒否率。人の評価がなければ null） */
    falseRejectionRate: number | null;
    falseRejectionLabeled: number;
    /** 流動性・スプレッドは外生価格モードでは測定できない */
    liquidityImpact: null;
  };
  evidence: {
    /** 引用した規則が実在し、提示した規則に含まれる割合（引用のある判断が対象） */
    citationValidRate: number | null;
    /** 説明（rationale）がある判断の割合 */
    rationaleRate: number | null;
    /** 説明では「適法」としたが規則エンジンに拒否された割合（拒否が対象） */
    reasoningActionMismatchRate: number | null;
    /** Judge が渡していない証拠 ID を引用した割合 */
    judgeInvalidEvidenceRate: number | null;
  };
};

export type ReliabilitySummary = {
  /** 各 Judge（評価の実行）と人の評価の一致 */
  judgeVsHuman: { runId: string; name: string; stats: AgreementStats; unevaluableRate: number | null }[];
  /** 趣旨逸脱の事前基準（コード）と人の評価の一致 */
  criteriaVsHuman: AgreementStats;
  /** 規則エンジンの形式判定が正しいと評価された割合 */
  formalCorrectRate: number | null;
  formalReviewed: number;
  /** Judge どうしの一致（同じ判断を評価したもの） */
  judgeVsJudge: { a: string; b: string; stats: AgreementStats }[];
  /** 評価者どうしの一致 */
  humanVsHuman: { a: string; b: string; stats: AgreementStats }[];
  goldLabels: number;
};
