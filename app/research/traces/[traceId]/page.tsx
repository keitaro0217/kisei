'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Loading, PageHeader } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { TraceRecord, TraceSpan } from '@/lib/research/trace-types';

// トレースの詳細: Span のツリー・時系列・詳細パネル。

const KIND_LABEL: Record<string, string> = {
  episode: 'セッション',
  step: 'ステップ',
  'market.observe': '市場の観測',
  'market.settle': '約定',
  retrieval: '規則の提示',
  llm: 'モデル呼び出し',
  order: '注文',
  'evaluation.formal': '形式評価',
  'evaluation.intent': '趣旨評価',
};

const BOUNDARY = 0.1;

function stepFlags(children: TraceSpan[]) {
  const formal = children.find((c) => c.kind === 'evaluation.formal');
  const intent = children.find((c) => c.kind === 'evaluation.intent');
  const margin = formal?.attributes.boundaryMargin;
  return {
    error: children.some((c) => c.status === 'ERROR'),
    violation: formal?.attributes.ruleViolation === true,
    deviation: Array.isArray(intent?.attributes.deviationCodes) && (intent!.attributes.deviationCodes as string[]).length > 0,
    boundary: typeof margin === 'number' && margin <= BOUNDARY,
  };
}

function Bar({ span, start, total }: { span: TraceSpan; start: number; total: number }) {
  const left = total > 0 ? ((Date.parse(span.startedAt) - start) / total) * 100 : 0;
  const width = total > 0 ? Math.max(0.5, ((span.durationMs ?? 0) / total) * 100) : 100;
  return (
    <div className="relative h-1.5 w-full rounded bg-white/5" aria-hidden>
      <div className={`absolute h-1.5 rounded ${span.status === 'ERROR' ? 'bg-rose-400' : 'bg-white/60'}`} style={{ left: `${Math.min(left, 99.5)}%`, width: `${Math.min(width, 100 - left)}%` }} />
    </div>
  );
}

function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-ink-400">—</span>;
  if (Array.isArray(v)) return <span>{v.length ? v.join(', ') : '（なし）'}</span>;
  return <span>{String(v)}</span>;
}

export default function TraceDetailPage() {
  const { traceId } = useParams<{ traceId: string }>();
  const basic = useBasicSettings() ?? undefined;
  const [trace, setTrace] = useState<TraceRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    api<{ trace: TraceRecord }>(`/traces/${traceId}`)
      .then((r) => setTrace(r.trace))
      .catch((e) => setError(e.message));
  }, [traceId]);

  const tree = useMemo(() => {
    const children = new Map<string | null, TraceSpan[]>();
    for (const s of trace?.spans ?? []) children.set(s.parentSpanId, [...(children.get(s.parentSpanId) ?? []), s]);
    return children;
  }, [trace]);

  if (error) return <Alert kind="error" title="読み込みに失敗しました">{error}</Alert>;
  if (!trace) return <Loading />;

  const root = tree.get(null)?.[0];
  const start = Date.parse(trace.startedAt);
  const total = trace.durationMs;
  const steps = root ? (tree.get(root.spanId) ?? []) : [];
  const shownSteps = steps.filter((s) => !onlyFlagged || Object.values(stepFlags(tree.get(s.spanId) ?? [])).some(Boolean));
  const span = trace.spans.find((s) => s.spanId === selected) ?? root;
  const stepOf = (s: TraceSpan | undefined) => {
    let cur = s;
    while (cur && cur.kind !== 'step') cur = trace.spans.find((x) => x.spanId === cur!.parentSpanId);
    return typeof cur?.attributes.step === 'number' ? cur.attributes.step : null;
  };
  const step = stepOf(span);
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  const row = (s: TraceSpan, depth: number) => (
    <button
      key={s.spanId}
      type="button"
      onClick={() => setSelected(s.spanId)}
      className={`grid w-full grid-cols-[minmax(0,1fr)_120px] items-center gap-3 rounded px-2 py-1 text-left text-xs ${selected === s.spanId ? 'bg-white/10' : 'hover:bg-white/5'}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`truncate ${s.status === 'ERROR' ? 'text-rose-300' : 'text-ink-100'}`}>{s.name}</span>
        <span className="shrink-0 text-[10px] text-ink-400">{KIND_LABEL[s.kind] ?? s.kind}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-ink-400">{s.durationMs ?? '—'}ms</span>
      </span>
      <Bar span={s} start={start} total={total} />
    </button>
  );

  return (
    <>
      <PageHeader
        title={`トレース ${trace.conditionId} / 反復 ${trace.replicate}`}
        description={`開始 ${formatDate(trace.startedAt, basic)}・所要 ${(trace.durationMs / 1000).toFixed(2)} 秒・Span ${trace.spans.length} 件・本文の記録: ${{ metadata: '保存なし', redacted: '伏せ字', full: 'そのまま' }[trace.payloadMode]}`}
        actions={
          <>
            <Link href={`/research/studies/${trace.studyId}`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
              研究の結果へ
            </Link>
            <a href={`/api/research/traces/${trace.traceId}?download=1`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
              JSON
            </a>
            <a href={`/api/research/traces/${trace.traceId}?download=1&format=otlp`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
              OpenTelemetry 形式
            </a>
          </>
        }
      />
      {trace.truncated && (
        <div className="mb-4">
          <Alert kind="warning" title="一部の本文または Span を上限で切り詰めています" />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Span のツリーと時系列"
          actions={
            <label className="flex items-center gap-2 text-xs text-ink-100">
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
              違反・趣旨逸脱・閾値付近・エラーのあるステップだけ表示
            </label>
          }
        >
          {root && row(root, 0)}
          <div className="max-h-[70vh] overflow-y-auto">
            {shownSteps.map((s) => {
              const kids = tree.get(s.spanId) ?? [];
              const f = stepFlags(kids);
              return (
                <div key={s.spanId} className="border-t border-white/5">
                  <div className="flex items-center">
                    <button type="button" onClick={() => toggle(s.spanId)} className="w-6 text-xs text-ink-300" aria-label={open.has(s.spanId) ? '閉じる' : '開く'} aria-expanded={open.has(s.spanId)}>
                      {open.has(s.spanId) ? '▾' : '▸'}
                    </button>
                    <div className="min-w-0 flex-1">{row(s, 0)}</div>
                    <span className="flex shrink-0 gap-1 pr-1">
                      {f.error && <Badge className="bg-rose-500/10 text-rose-200 ring-rose-400/30">エラー</Badge>}
                      {f.violation && <Badge className="bg-rose-500/10 text-rose-200 ring-rose-400/30">違反</Badge>}
                      {f.deviation && <Badge className="bg-amber-500/10 text-amber-200 ring-amber-400/30">趣旨逸脱</Badge>}
                      {f.boundary && <Badge className="bg-sky-500/10 text-sky-200 ring-sky-400/30">閾値付近</Badge>}
                    </span>
                  </div>
                  {open.has(s.spanId) && kids.map((k) => [row(k, 2), ...(tree.get(k.spanId) ?? []).map((g) => row(g, 3))])}
                </div>
              );
            })}
          </div>
        </Card>

        {span && (
          <Card title={span.name} description={`${KIND_LABEL[span.kind] ?? span.kind}・${span.durationMs ?? '—'} ms`}>
            <div className="space-y-4 text-xs">
              {span.error && (
                <Alert kind="error" title={span.error.type}>
                  {span.error.message}
                </Alert>
              )}
              <dl className="space-y-1.5">
                {Object.entries(span.attributes).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2">
                    <dt className="text-ink-300">{k}</dt>
                    <dd className="break-all text-ink-100">
                      <Value v={v} />
                    </dd>
                  </div>
                ))}
              </dl>
              {(span.kind === 'retrieval' || span.kind === 'episode') && (
                <Link href="/research/rules" className="inline-block text-ink-100 underline underline-offset-2">
                  規則・条文の画面で参照した版を確認する
                </Link>
              )}
              {step !== null && (
                <Link
                  href={`/research/studies/${trace.studyId}?condition=${encodeURIComponent(trace.conditionId)}&replicate=${trace.replicate}&step=${step}`}
                  className="block text-ink-100 underline underline-offset-2"
                >
                  このステップの意思決定ログ・評価を開く
                </Link>
              )}
              {span.input !== undefined && (
                <div>
                  <p className="mb-1 font-semibold text-ink-100">入力</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-ink-950/60 p-2 font-mono text-[11px] text-ink-100">{span.input}</pre>
                </div>
              )}
              {span.output !== undefined && (
                <div>
                  <p className="mb-1 font-semibold text-ink-100">出力</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-ink-950/60 p-2 font-mono text-[11px] text-ink-100">{span.output}</pre>
                </div>
              )}
              {trace.payloadMode === 'metadata' && (span.kind === 'llm' || span.kind === 'episode') && (
                <p className="text-ink-300">本文の記録が「保存なし」の設定で実行されたため、プロンプト・応答の本文はありません（設定 → セキュリティで変更できます）。</p>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
