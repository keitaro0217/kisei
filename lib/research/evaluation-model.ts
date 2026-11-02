// 評価の統一モデル（Phase 2）。各評価器の判定を独立に表し、複合評価（集約ロジックは版で管理）と分けて扱う。
// - 形式的な適合性（formal）と規則の趣旨への適合性（intent）は別々の評価軸として持つ。
// - 判定は研究用のシミュレーション内の規則についての評価であり、法的な結論ではない。
// - LLM が自己申告する不確実性（uncertainty）は、外部ラベルに対する正解率とは別のもの（校正されていない）。

/** 判定カテゴリ（6分類） */
export type EvalCategory =
  /** 明示的な規則に適合（趣旨からの逸脱も見つからない） */
  | 'compliant'
  /** 明示的な規則に違反 */
  | 'explicit_violation'
  /** 文言上は適合するが、規則の趣旨から逸脱 */
  | 'intent_deviation'
  /** 規則の解釈に争いがある（評価器・評価者の間で判断が分かれる、または評価器が解釈が分かれると判断） */
  | 'contested'
  /** 証拠不足（判断に必要な情報が記録にない） */
  | 'insufficient_evidence'
  /** 評価不能（行動が解釈できない、評価器が失敗した、など） */
  | 'unevaluable';

export const EVAL_CATEGORIES: readonly EvalCategory[] = ['compliant', 'explicit_violation', 'intent_deviation', 'contested', 'insufficient_evidence', 'unevaluable'];

/** 「問題あり」とみなすカテゴリ（2値の指標で陽性とする） */
export const POSITIVE_CATEGORIES: readonly EvalCategory[] = ['explicit_violation', 'intent_deviation'];

export const evalCategoryLabels: Record<EvalCategory, string> = {
  compliant: '規則に適合',
  explicit_violation: '明示的な規則違反',
  intent_deviation: '文言上は適合・趣旨から逸脱',
  contested: '解釈に争いあり',
  insufficient_evidence: '証拠不足',
  unevaluable: '評価不能',
};

export type FormalAxis = 'compliant' | 'violation' | 'not_evaluable' | 'not_evaluated';
export type IntentAxis = 'aligned' | 'deviation' | 'contested' | 'insufficient_evidence' | 'not_evaluable' | 'not_evaluated';

export type EvaluatorKind = 'deterministic' | 'criteria' | 'llm_judge' | 'human' | 'composite';

export type EvaluatorRef = {
  kind: EvaluatorKind;
  /** 評価器の識別子（規則エンジンの版、事前基準の版、Judge の評価の実行 ID、評価者名、集約ロジックの版） */
  id: string;
  name: string;
  /** 評価の基準・プロンプトの版 */
  version: string;
  model: string | null;
  providerType: string | null;
  /**
   * 行動を生成したモデルと独立か（LLM Judge のみ）。true = 別のモデル、false = 同じモデル（自己評価）、null = 判定できない/対象外
   */
  independentOfGenerator: boolean | null;
};

export type ReviewState = 'unreviewed' | 'approved' | 'corrected' | 'rejected';

export type EpisodeRef = { studyId: string; conditionId: string; replicate: number; step: number };
export const episodeIdOf = (t: Pick<EpisodeRef, 'studyId' | 'conditionId' | 'replicate'>) => `${t.studyId}/${t.conditionId}/${t.replicate}`;
export const itemKeyOf = (t: EpisodeRef) => `${t.studyId}/${t.conditionId}/${t.replicate}/${t.step}`;

/** 1つの評価器による、1つの判断（エピソードの1ステップ）の評価 */
export type EvaluationRecord = {
  /** 評価器と対象から決まる ID（同じ評価器・同じ対象なら同じ ID） */
  id: string;
  target: EpisodeRef & { episodeId: string; itemKey: string };
  evaluator: EvaluatorRef;
  /** 適用した規則（規則キー@版） */
  appliedRules: string[];
  formal: FormalAxis;
  intent: IntentAxis;
  category: EvalCategory;
  rationale: string;
  /** 参照した証拠（判断記録のフィールド、Judge に渡した証拠 ID など） */
  evidence: string[];
  /** 評価器の自己申告の不確実性（校正されていない）。コードの評価器では null */
  uncertainty: 'low' | 'medium' | 'high' | null;
  at: string;
  review: { state: ReviewState; by: string | null; at: string | null; note: string | null; correctedCategory: EvalCategory | null };
  isMock: boolean;
};

/** 複合評価（集約ロジックの版つき）。単純な多数決ではなく、不一致は「解釈に争いあり」として残す */
export type CompositeEvaluation = {
  target: EvaluationRecord['target'];
  aggregationVersion: string;
  category: EvalCategory;
  formal: FormalAxis;
  intent: IntentAxis;
  /** 何に基づいて決めたか */
  basis: 'deterministic' | 'human' | 'agreement' | 'single_evaluator' | 'disagreement' | 'evaluator_failure';
  disagreement: boolean;
  /** 趣旨の評価に参加した評価器の数と、その判定の内訳 */
  votes: { evaluator: string; kind: EvaluatorKind; intent: IntentAxis }[];
  needsHumanReview: boolean;
  isMock: boolean;
};

// ---------- ラベル付きデータセット（評価器の妥当性の検証用） ----------

/**
 * ラベルの用途。
 * evaluation_test: 評価器のテスト用（合成のケースなど、正解を作ったもの）
 * external_gold: 外部の専門家などによる正解ラベル（研究の評価に使う）
 */
export type LabelSetPurpose = 'evaluation_test' | 'external_gold';

export type LabelSet = {
  id: string;
  name: string;
  version: number;
  purpose: LabelSetPurpose;
  description: string;
  /** 出典（誰が、どの基準でラベルを付けたか） */
  source: string;
  /** ラベル付けの基準の版 */
  guidelineVersion: string;
  /** 固定すると、ラベルの追加・変更はできない（変更は新しい版で行う） */
  frozen: boolean;
  createdAt: string;
  createdBy: string;
  labelCount: number;
  annotators: string[];
};

export type GoldLabel = {
  setId: string;
  target: EpisodeRef;
  itemKey: string;
  annotator: string;
  category: EvalCategory;
  formal: 'compliant' | 'violation' | null;
  note: string;
  at: string;
};

export type RateCi = { k: number; n: number; p: number | null; ci: [number, number] | null };

export type ClassMetrics = {
  category: EvalCategory;
  /** 正解ラベルでこのカテゴリの件数（support） */
  support: number;
  predicted: number;
  precision: RateCi;
  recall: RateCi;
  f1: number | null;
};

export type ValidationMetrics = {
  /** measured: 比較できたラベルがある / not_measured: 正解ラベルがない（指標は表示しない） */
  status: 'measured' | 'not_measured';
  evaluator: EvaluatorRef;
  n: number;
  /** 正解ラベルの付いた判断のうち、この評価器が評価していなかったもの */
  missingPredictions: number;
  /** 正解ラベルの評価者が割れて正解が決まらなかったもの（比較から除外） */
  disputedGold: number;
  categories: EvalCategory[];
  /** confusion[正解][予測] */
  confusion: Record<string, Record<string, number>>;
  accuracy: RateCi;
  perClass: ClassMetrics[];
  macroF1: number | null;
  weightedF1: number | null;
  kappa: number | null;
  kappaCi: [number, number] | null;
  /** 「問題あり」（明示的違反・趣旨逸脱）を陽性とした2値の指標 */
  binary: { tp: number; fp: number; fn: number; tn: number; precision: RateCi; recall: RateCi; fpr: RateCi; fnr: RateCi; f1: number | null };
  /** 評価器の自己申告の不確実性ごとの正解率（自信と正解率は別物であることを示す） */
  byUncertainty: { uncertainty: 'low' | 'medium' | 'high' | 'none'; accuracy: RateCi }[];
  warnings: string[];
};

export type BiasCheck = {
  kind: 'self_evaluation' | 'evaluator_model' | 'prompt_version' | 'evidence_order' | 'repeatability' | 'category_ambiguity' | 'annotator_disagreement';
  title: string;
  /** 比較した2者 */
  a: string;
  b: string;
  n: number;
  agreement: number | null;
  kappa: number | null;
  /** 正解ラベルがある場合の、それぞれの正解率 */
  accuracyA: RateCi | null;
  accuracyB: RateCi | null;
  note: string;
};
