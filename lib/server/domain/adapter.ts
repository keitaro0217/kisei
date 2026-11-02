import type { DomainDescriptor } from '@/lib/domain/descriptors';
import type { ActionSpec, DomainAction, EpisodeOutcome, EvidenceRef, FormalResult, IntentResult, Observation } from '@/lib/domain/model';
import type { RuleVersion } from '@/lib/research/study-types';

// ドメインアダプター（業種別の評価環境）のインターフェース。
// 実行ループ（lib/server/domain/runner.ts）と研究の仕組み（凍結・リース・トレース）は業種に依存しない。
// 規則の判定は共通の規則 DSL（lib/server/rules/dsl.ts）で行い、アダプターは判定に使う変数（スコープ）を提供する。
// 正解（シナリオの生成器が注入した欠陥など）は、評価器・エージェントに渡さない（Phase 3 以降の研究品質の要件）。

export type ScenarioConfig = Record<string, number | string | boolean>;

export type StepResult<S> = {
  state: S;
  formal: FormalResult;
  intent: IntentResult;
  outcome: { reward: number; events: string[] };
};

export interface DomainAdapter<S> {
  readonly descriptor: DomainDescriptor;
  /** シナリオの初期状態（同じ設定・同じシードなら同じ状態） */
  initializeScenario(config: ScenarioConfig, seed: number): S;
  /** エージェントに見せる観測（参照できる文書は実行ループが条件に応じて付ける） */
  observe(state: S): Omit<Observation, 'documents'>;
  /** この時点で取れる行動（業務プロセスで許された行動の範囲に限る） */
  listPermittedActions(state: S, allowed?: string[]): ActionSpec[];
  /** 行動の形式（種類・引数の型・存在しない ID）の検証。規則の判定ではない */
  validateAction(state: S, action: DomainAction): { ok: boolean; errors: { code: string; message: string }[] };
  /** 規則の形式的な判定（規則 DSL の checks） */
  evaluateFormalCompliance(state: S, action: DomainAction, rules: RuleVersion[]): FormalResult;
  /** 規則の目的からの逸脱の判定（規則 DSL の intentCriteria。形式的に受理された行動が対象） */
  evaluateIntentAlignment(state: S, action: DomainAction, rules: RuleVersion[]): IntentResult;
  /** 行動を適用する（判定と、受理された場合の状態の更新、時間の経過）。元の state は変更しない */
  applyAction(state: S, action: DomainAction, rules: RuleVersion[]): StepResult<S>;
  /** エピソードの結果（業務の目標の達成度・指標） */
  calculateOutcome(state: S): EpisodeOutcome;
  /** 判定の根拠（状態・行動・規則） */
  getEvidence(state: S, action: DomainAction, result: Pick<StepResult<S>, 'formal' | 'intent'>): EvidenceRef[];
  /** 初期状態に戻す（initializeScenario と同じ設定・シード） */
  reset(config: ScenarioConfig, seed: number): S;

  // ---- エージェントとのやりとり（モックのエージェントと LLM） ----
  /** モックのエージェント（決定論的。persona で行動の傾向を変える）。AI の行動ではない */
  mockAction(state: S, seed: number, persona: string): DomainAction;
  /** LLM の出力（JSON）を行動に変換する。解釈できない場合は parse = invalid */
  parseAction(text: string): { action: DomainAction; rationale: string | null };
  /** LLM に渡す指示（出力形式の説明） */
  responseFormat(): string;
  /** エピソードの長さ（ステップ数） */
  steps(config: ScenarioConfig): number;
}

export function invalidAction(raw: string): DomainAction {
  return { type: 'invalid', args: {}, parse: 'invalid', raw: raw.slice(0, 2000) };
}

/** LLM の出力から最初の JSON オブジェクトを取り出す */
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
