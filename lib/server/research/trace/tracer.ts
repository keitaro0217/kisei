import { randomBytes } from 'node:crypto';
import type { SpanKind, TracePayloadMode, TraceRecord, TraceSpan } from '@/lib/research/trace-types';
import { redact } from '../../security/redact';

// セッション（1条件 × 1反復）の実行トレースを組み立てる。
// - 本文（プロンプト・応答）は記録モードに従って保存する: metadata = 保存しない、redacted = 秘密情報・個人情報を伏せる、full = そのまま。
// - いずれのモードでも API キー・Authorization ヘッダーは扱わない（呼び出し側で渡さない）。

/** 1つの本文の最大文字数（大量のトレースでデータベースを圧迫しないため） */
export const MAX_PAYLOAD_CHARS = 4000;
/** 1トレースの最大 Span 数 */
export const MAX_SPANS = 5000;

const PII_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // メールアドレス
  /\b\d{10,}\b/g, // 口座番号・電話番号などの長い数字列
];

export function maskPayload(text: string, mode: TracePayloadMode): string | undefined {
  if (mode === 'metadata') return undefined;
  let out = mode === 'redacted' ? PII_PATTERNS.reduce((s, p) => s.replace(p, '[MASKED]'), redact(text)) : text;
  if (out.length > MAX_PAYLOAD_CHARS) out = `${out.slice(0, MAX_PAYLOAD_CHARS)}…[truncated]`;
  return out;
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');

export class Tracer {
  readonly traceId = hex(16);
  private readonly spans: TraceSpan[] = [];
  private readonly startedMs = Date.now();
  private truncated = false;

  constructor(
    private readonly meta: { studyId: string; conditionId: string; replicate: number },
    readonly payloadMode: TracePayloadMode,
  ) {}

  start(name: string, kind: SpanKind, parent: TraceSpan | null, attributes: TraceSpan['attributes'] = {}): TraceSpan {
    const span: TraceSpan = {
      spanId: hex(8),
      parentSpanId: parent?.spanId ?? null,
      name,
      kind,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      status: 'OK',
      attributes,
    };
    if (this.spans.length < MAX_SPANS) this.spans.push(span);
    else this.truncated = true;
    return span;
  }

  end(span: TraceSpan, extra: { attributes?: TraceSpan['attributes']; input?: string; output?: string; error?: { type: string; message: string } } = {}) {
    const ended = Date.now();
    span.endedAt = new Date(ended).toISOString();
    span.durationMs = ended - Date.parse(span.startedAt);
    if (extra.attributes) Object.assign(span.attributes, extra.attributes);
    if (extra.input !== undefined) span.input = maskPayload(extra.input, this.payloadMode);
    if (extra.output !== undefined) span.output = maskPayload(extra.output, this.payloadMode);
    if ((extra.input?.length ?? 0) > MAX_PAYLOAD_CHARS || (extra.output?.length ?? 0) > MAX_PAYLOAD_CHARS) this.truncated = true;
    if (extra.error) {
      span.status = 'ERROR';
      span.error = { type: extra.error.type, message: redact(extra.error.message).slice(0, 500) };
    }
  }

  /** 開始済みで終了していない Span を、エラーとして閉じる（例外で中断した場合） */
  failOpen(error: { type: string; message: string }) {
    for (const s of this.spans) if (!s.endedAt) this.end(s, { error });
  }

  record(): TraceRecord {
    return {
      traceId: this.traceId,
      ...this.meta,
      payloadMode: this.payloadMode,
      startedAt: new Date(this.startedMs).toISOString(),
      durationMs: Date.now() - this.startedMs,
      status: this.spans.some((s) => s.status === 'ERROR') ? 'ERROR' : 'OK',
      truncated: this.truncated,
      spans: this.spans,
    };
  }
}

/** OpenTelemetry（OTLP/JSON）形式への変換。外部の観測基盤へ取り込むためのエクスポート用 */
export function toOtlp(t: TraceRecord, serviceName = 'kisei') {
  const attr = (k: string, v: unknown) => ({
    key: k,
    value:
      typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { boolValue: v } : { stringValue: Array.isArray(v) ? v.join(',') : String(v ?? '') },
  });
  const nanos = (iso: string | null) => (iso ? `${BigInt(Date.parse(iso)) * BigInt(1_000_000)}` : undefined);
  return {
    resourceSpans: [
      {
        resource: { attributes: [attr('service.name', serviceName), attr('kisei.study_id', t.studyId), attr('kisei.condition_id', t.conditionId), attr('kisei.replicate', t.replicate)] },
        scopeSpans: [
          {
            scope: { name: 'kisei.research', version: '1' },
            spans: t.spans.map((s) => ({
              traceId: t.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId ?? undefined,
              name: s.name,
              kind: 1,
              startTimeUnixNano: nanos(s.startedAt),
              endTimeUnixNano: nanos(s.endedAt),
              attributes: [attr('kisei.kind', s.kind), ...Object.entries(s.attributes).map(([k, v]) => attr(`kisei.${k}`, v))],
              status: s.status === 'ERROR' ? { code: 2, message: s.error?.message ?? '' } : { code: 1 },
            })),
          },
        ],
      },
    ],
  };
}
