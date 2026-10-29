'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { Study } from '@/lib/research/study-types';
import type { TraceSummary } from '@/lib/research/trace-types';

// 実行トレースの検索。研究・条件・反復・モデル・違反・趣旨逸脱・閾値付近・エラー・期間で絞り込む。

const FLAG = [
  ['', 'すべて'],
  ['true', 'あり'],
  ['false', 'なし'],
] as const;

function TraceSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const basic = useBasicSettings() ?? undefined;
  const [studies, setStudies] = useState<Study[]>([]);
  const [traces, setTraces] = useState<TraceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    study: params.get('study') ?? '',
    condition: params.get('condition') ?? '',
    replicate: params.get('replicate') ?? '',
    model: params.get('model') ?? '',
    status: params.get('status') ?? '',
    violation: params.get('violation') ?? '',
    deviation: params.get('deviation') ?? '',
    boundary: params.get('boundary') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  }));
  const offset = Number(params.get('offset') ?? 0) || 0;

  useEffect(() => {
    api<{ studies: Study[] }>('/studies')
      .then((r) => setStudies(r.studies))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(params.toString());
    q.set('limit', '50');
    api<{ traces: TraceSummary[] }>(`/traces?${q}`)
      .then((r) => setTraces(r.traces))
      .catch((e) => setError(e.message));
  }, [params]);

  const apply = (next: typeof form, nextOffset = 0) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v);
    if (nextOffset) q.set('offset', String(nextOffset));
    router.push(`/research/traces?${q}`);
  };
  const studyTitle = (id: string) => studies.find((s) => s.id === id)?.design.title ?? id.slice(0, 8);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const selectedStudy = studies.find((s) => s.id === form.study);

  return (
    <>
      <PageHeader
        title="実行トレース"
        description="研究のセッションごとに、市場の観測・規則の提示・モデルの呼び出し・注文・評価の流れを記録しています。記録するのはモデルの入出力と操作だけで、モデル内部の非公開の思考は含みません。"
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="読み込みに失敗しました" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="検索条件">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="研究">
              <select className={inputClass} value={form.study} onChange={(e) => setForm({ ...form, study: e.target.value, condition: '' })}>
                <option value="">すべて</option>
                {studies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.design.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="条件">
              <select className={inputClass} value={form.condition} onChange={set('condition')} disabled={!selectedStudy}>
                <option value="">すべて</option>
                {selectedStudy?.design.conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="反復（エピソード）">
              <input className={inputClass} value={form.replicate} onChange={set('replicate')} inputMode="numeric" placeholder="例: 0" />
            </Field>
            <Field label="モデル">
              <input className={inputClass} value={form.model} onChange={set('model')} placeholder="例: mock" />
            </Field>
            {(
              [
                ['violation', '規則違反'],
                ['deviation', '趣旨逸脱の基準'],
                ['boundary', '閾値付近の行動'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <select className={inputClass} value={form[k]} onChange={set(k)}>
                  {FLAG.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <Field label="エラー">
              <select className={inputClass} value={form.status} onChange={set('status')}>
                <option value="">すべて</option>
                <option value="ERROR">エラーあり</option>
                <option value="OK">エラーなし</option>
              </select>
            </Field>
            <Field label="期間（開始）">
              <input type="datetime-local" className={inputClass} value={form.from.slice(0, 16)} onChange={set('from')} />
            </Field>
            <Field label="期間（終了）">
              <input type="datetime-local" className={inputClass} value={form.to.slice(0, 16)} onChange={set('to')} />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => apply(form)}>
              検索
            </Button>
            <Button
              onClick={() => {
                const empty = Object.fromEntries(Object.keys(form).map((k) => [k, ''])) as typeof form;
                setForm(empty);
                apply(empty);
              }}
            >
              条件をクリア
            </Button>
          </div>
        </Card>

        <Card title="トレース">
          {traces === null ? (
            <Loading />
          ) : (
            <>
              <Table head={['開始日時', '研究', '条件', '反復', 'モデル', 'Span数', '所要時間', '検出', '本文']} empty="該当するトレースはありません（研究を実行すると記録されます）">
                {traces.map((t) => (
                  <tr key={t.traceId}>
                    <td className={td}>
                      <Link href={`/research/traces/${t.traceId}`} className="font-medium text-white underline-offset-2 hover:underline">
                        {formatDate(t.startedAt, basic)}
                      </Link>
                    </td>
                    <td className={td}>{studyTitle(t.studyId)}</td>
                    <td className={td}>{t.conditionId}</td>
                    <td className={td}>{t.replicate}</td>
                    <td className={`${td} font-mono text-xs`}>{t.model ?? '—'}</td>
                    <td className={td}>{t.spanCount.toLocaleString()}</td>
                    <td className={td}>{(t.durationMs / 1000).toFixed(2)} 秒</td>
                    <td className={td}>
                      <span className="flex flex-wrap gap-1">
                        {t.hasError && <Badge className="bg-rose-500/10 text-rose-200 ring-rose-400/30">エラー</Badge>}
                        {t.hasViolation && <Badge className="bg-rose-500/10 text-rose-200 ring-rose-400/30">違反</Badge>}
                        {t.hasDeviation && <Badge className="bg-amber-500/10 text-amber-200 ring-amber-400/30">趣旨逸脱</Badge>}
                        {t.hasBoundary && <Badge className="bg-sky-500/10 text-sky-200 ring-sky-400/30">閾値付近</Badge>}
                      </span>
                    </td>
                    <td className={`${td} text-xs`}>{{ metadata: '保存なし', redacted: '伏せ字', full: 'そのまま' }[t.payloadMode] ?? t.payloadMode}</td>
                  </tr>
                ))}
              </Table>
              <div className="mt-3 flex gap-2">
                <Button disabled={offset === 0} onClick={() => apply(form, Math.max(0, offset - 50))}>
                  前へ
                </Button>
                <Button disabled={traces.length < 50} onClick={() => apply(form, offset + 50)}>
                  次へ
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

export default function TracesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TraceSearch />
    </Suspense>
  );
}
