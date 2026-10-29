import type { FinalAssessment, IntentLabel } from './eval-types';
import type { AgentObjective, DecisionCategory, EquivalenceReview, PairClassification, Persona, StudyStatus } from './study-types';

// 実証研究機能の表示ラベル。

export const classificationLabels: Record<PairClassification, string> = {
  equivalent_wording: '意味が同じ言い換え',
  scope_change: '適用範囲の変更',
  exception_change: '例外条件の変更',
  ambiguity_change: '曖昧性の変更',
  other: 'その他',
};

export const reviewLabels: Record<EquivalenceReview, { label: string; className: string }> = {
  unreviewed: { label: '未確認', className: 'bg-amber-500/10 text-amber-200 ring-amber-400/30' },
  approved: { label: '研究者が確認済み', className: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30' },
  rejected: { label: '差し戻し', className: 'bg-rose-500/10 text-rose-200 ring-rose-400/30' },
};

export const studyStatusLabels: Record<StudyStatus, { label: string; className: string }> = {
  draft: { label: '下書き', className: 'bg-white/5 text-ink-100 ring-white/20' },
  running: { label: '実行中', className: 'bg-sky-500/10 text-sky-200 ring-sky-400/30' },
  paused: { label: '一時停止', className: 'bg-amber-500/10 text-amber-200 ring-amber-400/30' },
  completed: { label: '完了', className: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30' },
  stopped: { label: '停止', className: 'bg-rose-500/10 text-rose-200 ring-rose-400/30' },
};

export const objectiveLabels: Record<AgentObjective, string> = {
  compliance_first: '規則遵守を優先',
  profit_max: '利益の最大化',
  risk_adjusted: 'リスク調整後の利益',
  profit_with_evasion_incentive: '利益最大化＋事後監視の告知（合成市場での行動研究）',
  custom: '自由記述',
};

export const personaLabels: Record<Persona, string> = { conservative: '慎重', neutral: '標準', aggressive: '積極的' };

export const categoryLabels: Record<DecisionCategory, { label: string; className: string }> = {
  engine_rejected: { label: 'エンジンが拒否', className: 'bg-rose-500/10 text-rose-200 ring-rose-400/30' },
  intent_deviation: { label: '受理・趣旨逸脱の可能性', className: 'bg-amber-500/10 text-amber-200 ring-amber-400/30' },
  normal: { label: '受理（通常）', className: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30' },
  no_order: { label: '注文なし', className: 'bg-white/5 text-ink-100 ring-white/20' },
  undecidable: { label: '判定不能（出力を解釈できず）', className: 'bg-violet-500/10 text-violet-200 ring-violet-400/30' },
};

/** 条件の識別色（データ可視化の既定パレット・暗色面用の段階。固定順で割り当て、循環させない） */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** 多層評価の最終表示 */
export const finalLabels: Record<FinalAssessment, { label: string; className: string }> = {
  formal_ok_intent_ok: { label: '形式適合・趣旨適合', className: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30' },
  formal_ok_intent_deviation: { label: '形式適合・趣旨逸脱の疑い', className: 'bg-amber-500/10 text-amber-200 ring-amber-400/30' },
  formal_violation: { label: '形式違反', className: 'bg-rose-500/10 text-rose-200 ring-rose-400/30' },
  insufficient_evidence: { label: '証拠不足', className: 'bg-violet-500/10 text-violet-200 ring-violet-400/30' },
  evaluation_failed: { label: '判定失敗', className: 'bg-white/5 text-ink-100 ring-white/20' },
  pending_human: { label: '人による確認待ち', className: 'bg-sky-500/10 text-sky-200 ring-sky-400/30' },
};

export const intentLabels: Record<IntentLabel, string> = {
  aligned: '趣旨に適合',
  deviation_suspected: '趣旨逸脱の疑い',
  uncertain: '判断できない',
};

export const categoryOfFailureLabels: Record<'formal_violation' | 'intent_deviation' | 'boundary_exploitation', string> = {
  formal_violation: '形式違反',
  intent_deviation: '趣旨逸脱の疑い',
  boundary_exploitation: '閾値付近の行動',
};

export const severityLabels: Record<'low' | 'medium' | 'high', { label: string; className: string }> = {
  high: { label: '高', className: 'bg-rose-500/10 text-rose-200 ring-rose-400/30' },
  medium: { label: '中', className: 'bg-amber-500/10 text-amber-200 ring-amber-400/30' },
  low: { label: '低', className: 'bg-sky-500/10 text-sky-200 ring-sky-400/30' },
};

export const hypothesisStatusLabels: Record<string, { label: string; className: string }> = {
  HYPOTHESIS: { label: '仮説', className: 'bg-white/5 text-ink-100 ring-white/20' },
  SUPPORTED_BY_TRACE: { label: 'トレースで確認（因果は未検証）', className: 'bg-sky-500/10 text-sky-200 ring-sky-400/30' },
  EXPERIMENT_SCHEDULED: { label: '検証実験を作成', className: 'bg-sky-500/10 text-sky-200 ring-sky-400/30' },
  EXPERIMENT_TESTED: { label: '検証実験が完了', className: 'bg-sky-500/10 text-sky-200 ring-sky-400/30' },
  EVIDENCE_SUPPORTS_EFFECT: { label: '実験が効果を支持', className: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30' },
  EVIDENCE_INCONCLUSIVE: { label: '判断保留（区間が 0 をまたぐ）', className: 'bg-amber-500/10 text-amber-200 ring-amber-400/30' },
  EVIDENCE_AGAINST_EFFECT: { label: '効果に反する証拠', className: 'bg-rose-500/10 text-rose-200 ring-rose-400/30' },
};

export const datasetLabels: Record<'known_failure' | 'normal_behavior' | 'boundary' | 'previously_fixed', string> = {
  known_failure: '既知の Failure',
  normal_behavior: '正常な行動',
  boundary: '閾値付近',
  previously_fixed: '修正済み',
};
