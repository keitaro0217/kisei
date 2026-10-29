// 実行トレース（OpenTelemetry の Span に対応する内部モデル）。
// 記録するのは AI の「観測可能な入出力・ツール操作・取引所の処理」であり、モデル内部の非公開の思考は含まない。

export type TracePayloadMode = 'metadata' | 'redacted' | 'full';

export type SpanKind =
  | 'episode'
  | 'step'
  | 'market.observe'
  | 'market.settle'
  | 'retrieval'
  | 'llm'
  | 'order'
  | 'evaluation.formal'
  | 'evaluation.intent';

export type TraceSpan = {
  /** 16桁の16進数（OpenTelemetry の spanId 形式） */
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: 'OK' | 'ERROR';
  attributes: Record<string, string | number | boolean | null | string[]>;
  /** 入出力本文（記録モードが metadata の場合は保存しない） */
  input?: string;
  output?: string;
  error?: { type: string; message: string };
};

export type TraceRecord = {
  /** 32桁の16進数（OpenTelemetry の traceId 形式） */
  traceId: string;
  studyId: string;
  conditionId: string;
  replicate: number;
  payloadMode: TracePayloadMode;
  startedAt: string;
  durationMs: number;
  status: 'OK' | 'ERROR';
  /** 本文を上限で切り詰めた場合 true */
  truncated: boolean;
  spans: TraceSpan[];
};

export type TraceSummary = Omit<TraceRecord, 'spans'> & {
  spanCount: number;
  hasError: boolean;
  hasViolation: boolean;
  hasDeviation: boolean;
  hasBoundary: boolean;
  model: string | null;
};
