'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import EvidenceGraph from '@/components/research/EvidenceGraph';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { GraphEdge, GraphNode, Hypothesis } from '@/lib/research/failure-types';
import { hypothesisStatusLabels, studyStatusLabels } from '@/lib/research/study-labels';
import type { StudyStatus } from '@/lib/research/study-types';

// 原因の候補の詳細: 根拠・介入・統制実験・効果の推定・状態の履歴・証拠グラフ。

type Data = { hypothesis: Hypothesis; graph: { nodes: GraphNode[]; edges: GraphEdge[] }; experiment: { id: string; status: StudyStatus; isMock: boolean; frozenHash: string | null } | null };

const pt = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)} pt`);
const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);

export default function HypothesisPage() {
  const { id } = useParams<{ id: string }>();
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replicates, setReplicates] = useState('20');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Data>(`/hypotheses/${id}`)
        .then(setData)
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;
  const h = data.hypothesis;
  const act = async (action: 'schedule' | 'evaluate') => {
    setBusy(action);
    setError(null);
    try {
      await api(`/hypotheses/${id}/actions`, { method: 'POST', body: { action, replicates: Number(replicates), start: true } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const st = hypothesisStatusLabels[h.status];

  return (
    <>
      <PageHeader
        title={`原因の候補: ${h.title}`}
        description={h.description}
        actions={
          <Link href={`/research/failures/${h.fingerprint}`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            Failure のクラスターへ
          </Link>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="状態">
            <Badge className={st.className}>{st.label}</Badge>
            <ol className="mt-4 space-y-2 border-l border-white/10 pl-4 text-sm">
              {h.history.map((x, i) => (
                <li key={i}>
                  <span className="text-white">{hypothesisStatusLabels[x.status]?.label ?? x.status}</span>
                  <span className="ml-2 text-xs text-ink-300">
                    {formatDate(x.at, basic)}・{x.by}
                  </span>
                  {x.note && <p className="text-xs text-ink-200">{x.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
          <Card title="根拠（トレース）" description={h.evidence.note}>
            <p className="text-sm text-ink-100">Failure {h.evidence.failureCount} 件（元の研究・条件）</p>
            <ul className="mt-2 space-y-1 text-xs">
              {h.evidence.traceIds.map((t) => (
                <li key={t}>
                  <Link href={`/research/traces/${t}`} className="underline underline-offset-2">
                    トレース {t.slice(0, 12)}…
                  </Link>
                </li>
              ))}
              {h.evidence.exampleKeys.map((k) => {
                const [c, r, s] = k.split('/');
                return (
                  <li key={k}>
                    <Link href={`/research/studies/${h.sourceStudyId}?condition=${encodeURIComponent(c)}&replicate=${r}&step=${s}`} className="underline underline-offset-2">
                      判断 {c} / 反復 {r} / ステップ {Number(s) + 1}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <Card title="統制実験" description={`介入: ${h.intervention.description}。変える要因: ${h.changedFactors.join(', ')}。元の条件を対照（C）、要因だけを変えた条件を処置（T）とし、同じ市場・同じシードで実行します。`}>
          {!h.experimentStudyId ? (
            h.intervention.kind === 'none' ? (
              <Alert kind="info" title="自動で介入を作れない候補です">
                {h.intervention.description}
              </Alert>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="反復数" hint="2〜500">
                  <input className={`${inputClass} w-24`} value={replicates} onChange={(e) => setReplicates(e.target.value)} inputMode="numeric" />
                </Field>
                <Button variant="primary" busy={busy === 'schedule'} onClick={() => act('schedule')}>
                  検証実験を作成して開始
                </Button>
                <p className="w-full text-xs text-ink-300">元の研究が AI モデルを使っている場合、同じモデルを呼び出すため費用が発生します。</p>
              </div>
            )
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                <Link href={`/research/studies/${h.experimentStudyId}`} className="text-white underline underline-offset-2">
                  検証実験の研究を開く
                </Link>
                {data.experiment && (
                  <Badge className={`ml-2 ${studyStatusLabels[data.experiment.status].className}`}>{studyStatusLabels[data.experiment.status].label}</Badge>
                )}
                {data.experiment?.isMock && <span className="ml-2 text-xs text-violet-200">モックデータ</span>}
              </p>
              {data.experiment?.status === 'completed' && (
                <Button variant="primary" busy={busy === 'evaluate'} onClick={() => act('evaluate')}>
                  結果から評価する
                </Button>
              )}
              {h.effect && (
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-white">
                    Failure 率: 処置 {pct(h.effect.treatmentRate)} / 対照 {pct(h.effect.controlRate)}・差 {pt(h.effect.diff)}
                  </p>
                  <p className="text-ink-200">
                    95% 区間 {h.effect.ci ? `[${pt(h.effect.ci[0])}, ${pt(h.effect.ci[1])}]` : '—'}・対応のある反復 {h.effect.pairedReplicates}・並べ替え検定 p ={' '}
                    {h.effect.permutationP === null ? '—' : h.effect.permutationP.toFixed(3)}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200">
                    {h.effect.caveats.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="修正案" description="この原因の候補をもとに修正案を作成します（研究者の承認を経て、仮想環境でだけ検証します）。">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              busy={busy === 'patch'}
              onClick={async () => {
                setBusy('patch');
                setError(null);
                try {
                  await api('/patches', { method: 'POST', body: { hypothesisId: id } });
                  window.location.assign('/research/patches');
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(null);
                }
              }}
            >
              この候補から修正案を作成
            </Button>
          </div>
        </Card>

        <Card title="証拠グラフ">
          <EvidenceGraph nodes={data.graph.nodes} edges={data.graph.edges} />
        </Card>
      </div>
    </>
  );
}
