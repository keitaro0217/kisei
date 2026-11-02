// 共通ドメインモデル（Intent Phase 1）。業種に依存しない規則・目的・行動・結果の表現。
// - 永続化するエンティティは不変の ID（UUID）と版（整数）を持つ。版の更新は新しい行の追加で行い、元の行は変更しない。
// - 業種固有の処理（状態・行動・判定に使う変数）はドメインアダプターに分ける（lib/server/domain/）。
// - 規則の形式的な適合（formal）と、規則の目的（intent）への適合は別の評価軸として扱う。

export type DomainId = 'financial_market' | 'trading_company';

export type Versioned = { id: string; version: number };

export type Industry = { id: string; label: string };

/** 規則の原文の種別。合成の規則と、実在の法令・社内規程を区別する（実在の法令についての法的判断は行わない） */
export type RuleDocumentKind = 'synthetic' | 'real_law' | 'internal_policy';

export type RuleDocument = Versioned & {
  docKey: string;
  kind: RuleDocumentKind;
  title: string;
  /** 出典（法令名・規程名・URL・発行者など） */
  source: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** 取り込んだ形式と、本文の SHA-256（原本の同一性の確認） */
  format: 'text' | 'docx';
  sha256: string;
  text: string;
  createdAt: string;
  createdBy: string;
};

export type RuleElementKind = 'obligation' | 'prohibition' | 'permission' | 'exception' | 'threshold' | 'approval_condition' | 'definition' | 'purpose_candidate';
export type ReviewState = 'unreviewed' | 'approved' | 'rejected' | 'edited';

/** 規則の要素（義務・禁止・許可・例外・閾値・承認条件・定義・目的の候補）。原文の位置を根拠として持つ */
export type RuleElement = {
  id: string;
  documentId: string;
  documentVersion: number;
  kind: RuleElementKind;
  text: string;
  /** 原文の中の位置（文字のオフセット） */
  span: { start: number; end: number };
  /** 抽出の方法（pattern-v1 = 文型の規則による抽出、human = 人の入力） */
  extractionMethod: 'pattern-v1' | 'human';
  /** 閾値の場合の数値と単位 */
  value?: { number: number; unit: string } | null;
  review: { state: ReviewState; by: string | null; at: string | null; note: string | null };
};

/**
 * 規則の目的（PolicyIntent）。AI が勝手に確定しない。
 * - extracted: 原文から根拠（要素の位置）つきで抽出した候補。人が承認するまで candidate のまま。
 * - human_entered: 原文から確認できない場合に人が入力したもの（入力者を記録）。
 */
export type PolicyIntent = Versioned & {
  ruleKey: string;
  text: string;
  basis: 'extracted' | 'human_entered';
  documentId: string | null;
  evidenceElementId: string | null;
  status: 'candidate' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type BusinessProcess = Versioned & {
  processKey: string;
  industry: string;
  domain: DomainId;
  name: string;
  description: string;
  /** AI に与える業務の目標（目的関数）。規則の目的とは別に管理する */
  objective: string;
  /** AI が取れる行動の範囲（アダプターの行動の種類の部分集合） */
  permittedActions: string[];
  /** 適用する規則（規則キー） */
  ruleKeys: string[];
  createdAt: string;
  createdBy: string;
};

// ---------- 実行時の共通型（アダプターと実行ループの間の契約） ----------

export type Actor = { id: string; role: string; kind: 'ai_agent' | 'simulated_human' | 'system' };

export type Objective = { id: string; label: string; description: string };

/** 行動（ドメインごとの種類と引数）。LLM の出力を解釈できない場合は invalid */
export type DomainAction = { type: string; args: Record<string, string | number | boolean | null>; parse: 'ok' | 'invalid'; raw?: string };

export type ActionSpec = { type: string; label: string; args: Record<string, string> };

export type Observation = {
  step: number;
  /** エージェントに見せる状態（JSON にできる値のみ） */
  view: Record<string, unknown>;
  /** 参照できる文書（規則の条文・目的。提示の有無は条件で決まる） */
  documents: { id: string; title: string; text: string }[];
};

export type FormalResult = {
  verdict: 'ACCEPT' | 'REJECT' | 'NO_ACTION' | 'INVALID';
  violations: { code: string; message: string; ruleKey: string | null }[];
};

export type IntentResult = { deviations: { code: string; message: string; ruleKey: string }[] };

export type EvidenceRef = { kind: 'state' | 'action' | 'rule' | 'document' | 'outcome'; ref: string; detail: string };

/** 1ステップの記録（金融以外のドメイン。金融は既存の判断の記録 DecisionRecord を使う） */
export type DomainStepRecord = {
  studyId: string;
  conditionId: string;
  replicate: number;
  step: number;
  domain: DomainId;
  observation: Observation['view'];
  action: DomainAction;
  rationale: string | null;
  formal: FormalResult;
  intent: IntentResult;
  /** 行動の結果（状態の変化・ステップの報酬） */
  outcome: { reward: number; events: string[] };
  evidence: EvidenceRef[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null } | null;
  createdAt: string;
};

/** エピソード（セッション）の結果 */
export type EpisodeOutcome = { reward: number; metrics: Record<string, number>; notes: string[] };
