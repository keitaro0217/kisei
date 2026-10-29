'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import { diffText } from '@/lib/research/diff';
import type { Patch, PatchStatus, RateWithCi, RegressionRun } from '@/lib/research/patch-types';
import { datasetLabels, gateLabels, patchCategoryLabels, patchStatusLabels, studyStatusLabels } from '@/lib/research/study-labels';
import type { StudyStatus } from '@/lib/research/study-types';

// 修正案の詳細: 変更前後の差分・根拠・承認の流れ・回帰テスト・再実験。

type Data = { patch: Patch; runs: RegressionRun[]; experiment: { id: string; status: StudyStatus; isMock: boolean } | null };

const NEXT: Record<PatchStatus, { to: PatchStatus; label: string; variant?: 'primary' | 'danger' }[]> = {
  draft: [{ to: 'under_review', label: 'レビューに回す', variant: 'primary' }],
  under_review: [
    { to: 'approved_for_simulation', label: '実験への使用を承認', variant: 'primary' },
    { to: 'draft', label: '下書きに戻す' },
    { to: 'rejected', label: '却下', variant: 'danger' },
  ],
  approved_for_simulation: [
    { to: 'simulation_completed', label: '検証を完了にする', variant: 'primary' },
    { to: 'rejected', label: '却下', variant: 'danger' },
  ],
  simulation_completed: [
    { to: 'approved_for_recommendation', label: '提案として承認', variant: 'primary' },
    { to: 'rejected', label: '却下', variant: 'danger' },
  ],
  approved_for_recommendation: [{ to: 'archived', label: 'アーカイブ' }],
  rejected: [{ to: 'archived', label: 'アーカイブ' }],
  archived: [],
};

const rate = (r: RateWithCi) => (r.p === null ? '—' : `${(r.p * 100).toFixed(1)}%（${r.k}/${r.n}）${r.ci ? ` [${(r.ci[0] * 100).toFixed(1)}, ${(r.ci[1] * 100).toFixed(1)}]` : ''}`);
const num = (x: number | null, d = 1) => (x === null ? '—' : x.toFixed(d));

function TextDiff({ a, b }: { a: string; b: string }) {
  const parts = useMemo(() => diffText(a, b), [a, b]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(['a', 'b'] as const).map((side) => (
        <div key={side}>
          <p className="mb-1 text-xs text-ink-300">{side === 'a' ? '変更前' : '変更後'}</p>
          <p className="whitespace-pre-wrap rounded-lg bg-ink-950/50 p-3 text-sm text-ink-100">
            {parts.map((p, i) =>
              p.kind === 'same' ? (
                <span key={i}>{p.text}</span>
              ) : side === 'a' && p.kind === 'removed' ? (
                <del key={i} className="rounded bg-rose-500/25 px-0.5 text-rose-100">
                  {p.text}
                </del>
              ) : side === 'b' && p.kind === 'added' ? (
                <ins key={i} className="rounded bg-emerald-500/25 px-0.5 text-emerald-100 no-underline">
                  {p.text}
                </ins>
              ) : null,
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function PatchPage() {
  const { id } = useParams<{ id: string }>();
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [replicates, setReplicates] = useState('20');
  const [th, setTh] = useState({ maxFalseRejectionRate: '0.1', minPreventionRate: '0.8', minPreviouslyFixedPassRate: '1', minCasesPerDataset: '5', maxAddedCostUsd: '' });
  const [includeCandidates, setIncludeCandidates] = useState(false);

  const load = useCallback(
    () =>
      api<Data>(`/patches/${id}`)
        .then(setData)
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;
  const p = data.patch;
  const run = data.runs[0];

  const call = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      setNote('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title={p.title}
        description={`${patchCategoryLabels[p.category]}・対象 ${p.targetRuleKey}・生成 ${p.generator}・${formatDate(p.createdAt, basic)}`}
        actions={
          <Link href="/research/patches" className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            一覧へ
          </Link>
        }
      />
      <div className="mb-4">
        <Alert kind="info" title="この修正案は仮想環境の検証にだけ使います">
          実験用の規則は元の規則とは別の規則 ID（{p.targetRuleKey}-PATCH）で保存し、元の規則・業務設定・取引システムへ自動で反映することはありません。
        </Alert>
      </div>
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {p.isMock && (
        <div className="mb-4">
          <Alert kind="warning" title="モックデータに由来する修正案です" />
        </div>
      )}
      <div className="space-y-6">
        <Card title="変更内容">
          {p.after ? (
            <div className="space-y-4">
              <TextDiff a={p.before.text} b={p.after.text} />
              <details>
                <summary className="cursor-pointer text-xs text-ink-200">判定ロジック（変更前 / 変更後）</summary>
                <div className="mt-2 grid gap-4 md:grid-cols-2">
                  {[p.before, p.after].map((d, i) => (
                    <pre key={i} className="max-h-80 overflow-auto rounded-lg bg-ink-950/50 p-3 font-mono text-[11px] text-ink-100">
                      {JSON.stringify({ parameters: d.parameters, checks: d.checks, intentCriteria: d.intentCriteria }, null, 2)}
                    </pre>
                  ))}
                </div>
              </details>
            </div>
          ) : (
            <p className="text-sm text-ink-100">
              提示方法の変更: {Object.entries(p.presentation ?? {}).map(([k, v]) => `${k === 'includePurpose' ? '規制の趣旨の提示' : '条文の提示'} → ${v ? 'あり' : 'なし'}`).join('、')}（規則・判定ロジックは変えません）
            </p>
          )}
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-300">変更理由</dt>
              <dd className="text-ink-100">{p.reason}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-300">想定される改善</dt>
              <dd className="text-ink-100">{p.expectedImprovement}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-300">想定される副作用</dt>
              <dd className="text-ink-100">{p.expectedSideEffects}</dd>
            </div>
          </dl>
          <p className="mt-3 space-x-3 text-xs">
            {p.relatedFingerprint && (
              <Link href={`/research/failures/${p.relatedFingerprint}`} className="underline underline-offset-2">
                関連する Failure
              </Link>
            )}
            {p.relatedHypothesisId && (
              <Link href={`/research/hypotheses/${p.relatedHypothesisId}`} className="underline underline-offset-2">
                関連する原因の候補
              </Link>
            )}
          </p>
        </Card>

        <Card title="承認の流れ" description="実験に使う承認と、企業への修正提案として認める承認は別です。提案としての承認は、最新の回帰テストが FAIL のときはできません。">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={patchStatusLabels[p.status].className}>{patchStatusLabels[p.status].label}</Badge>
            {p.sandboxRuleId && <span className="text-xs text-ink-300">実験用の規則: {p.targetRuleKey}-PATCH</span>}
          </div>
          {NEXT[p.status].length > 0 && (
            <div className="mt-4 space-y-3">
              <Field label="判断の記録（却下・PASS 以外での承認では必須）">
                <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {NEXT[p.status].map((n) => (
                  <Button key={n.to} variant={n.variant ?? 'secondary'} busy={busy === n.to} onClick={() => call(n.to, `/patches/${id}/transition`, { to: n.to, note })}>
                    {n.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <ol className="mt-4 space-y-1 border-l border-white/10 pl-4 text-xs text-ink-200">
            {p.reviews.map((r, i) => (
              <li key={i}>
                {patchStatusLabels[r.from]?.label} → <span className="text-white">{patchStatusLabels[r.to]?.label}</span>・{r.by}・{formatDate(r.at, basic)}
                {r.note && <span className="text-ink-300">「{r.note}」</span>}
              </li>
            ))}
          </ol>
        </Card>

        <Card title="回帰テスト" description="承認済み（と、指定すれば候補）のテストケースを、修正前後の規則で決定論的に判定し直します（LLM は呼ばず、費用はかかりません）。閾値は 95% 区間で判定します。">
          <div className="grid gap-3 md:grid-cols-5">
            {(
              [
                ['maxFalseRejectionRate', '誤拒否率の上限'],
                ['minPreventionRate', '防げた割合の下限'],
                ['minPreviouslyFixedPassRate', '修正済みの成功率'],
                ['minCasesPerDataset', '最小件数'],
                ['maxAddedCostUsd', '追加費用の上限 (USD)'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <input className={inputClass} value={th[k]} onChange={(e) => setTh({ ...th, [k]: e.target.value })} inputMode="decimal" />
              </Field>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-100">
            <input type="checkbox" checked={includeCandidates} onChange={(e) => setIncludeCandidates(e.target.checked)} />
            未承認（候補）のテストケースも含める（結果は「要確認」になります）
          </label>
          <Button
            variant="primary"
            className="mt-3"
            busy={busy === 'regression'}
            disabled={!['approved_for_simulation', 'simulation_completed', 'approved_for_recommendation'].includes(p.status)}
            onClick={() => call('regression', `/patches/${id}/regression`, { thresholds: th, includeCandidates })}
          >
            回帰テストを実行
          </Button>
          {run && (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={gateLabels[run.gate].className}>{gateLabels[run.gate].label}</Badge>
                <span className="text-xs text-ink-300">
                  {formatDate(run.createdAt, basic)}・{run.engineVersion}・ケース {run.outcomes.length} 件（対象外 {run.metrics.notApplicable} 件）
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-100">
                {run.gateReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <Table head={['指標', '修正前', '修正後']}>
                <tr>
                  <td className={td}>既知の Failure を防げた割合</td>
                  <td className={td}>{rate(run.metrics.prevention.before)}</td>
                  <td className={td}>{rate(run.metrics.prevention.after)}</td>
                </tr>
                <tr>
                  <td className={td}>正常な行動の誤拒否率</td>
                  <td className={td}>{rate(run.metrics.falseRejection.before)}</td>
                  <td className={td}>{rate(run.metrics.falseRejection.after)}</td>
                </tr>
                <tr>
                  <td className={td}>修正済みケースの成功率</td>
                  <td className={td}>—</td>
                  <td className={td}>{rate(run.metrics.previouslyFixed.after)}</td>
                </tr>
                <tr>
                  <td className={td}>新たな失敗（修正前は合格・修正後は不合格）</td>
                  <td className={td}>—</td>
                  <td className={td}>{run.metrics.newFailures} 件</td>
                </tr>
              </Table>
              {run.experiment && (
                <Table head={['再実験（同じ市場・シード）', '修正前', '修正後']}>
                  <tr>
                    <td className={td}>規則違反率</td>
                    <td className={td}>{run.experiment.violationRate.control === null ? '—' : `${(run.experiment.violationRate.control * 100).toFixed(1)}%`}</td>
                    <td className={td}>{run.experiment.violationRate.treatment === null ? '—' : `${(run.experiment.violationRate.treatment * 100).toFixed(1)}%`}</td>
                  </tr>
                  <tr>
                    <td className={td}>損益の平均</td>
                    <td className={td}>{num(run.experiment.meanPnl.control, 0)}</td>
                    <td className={td}>{num(run.experiment.meanPnl.treatment, 0)}</td>
                  </tr>
                  <tr>
                    <td className={td}>費用 (USD)</td>
                    <td className={td}>{run.experiment.costUsd.control.toFixed(4)}</td>
                    <td className={td}>{run.experiment.costUsd.treatment.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td className={td}>セッション時間（秒）</td>
                    <td className={td}>{num(run.experiment.meanSessionSeconds.control, 2)}</td>
                    <td className={td}>{num(run.experiment.meanSessionSeconds.treatment, 2)}</td>
                  </tr>
                  <tr>
                    <td className={td}>失敗したセッション</td>
                    <td className={td}>{run.experiment.failedSessions.control}</td>
                    <td className={td}>{run.experiment.failedSessions.treatment}</td>
                  </tr>
                </Table>
              )}
              <details>
                <summary className="cursor-pointer text-xs text-ink-200">ケースごとの結果</summary>
                <div className="mt-2">
                  <Table head={['ケース', 'データセット', '修正前', '修正後', '期待との一致']}>
                    {run.outcomes.map((o) => (
                      <tr key={o.testCaseId}>
                        <td className={`${td} max-w-xs whitespace-normal text-xs`}>{o.title}</td>
                        <td className={td}>{datasetLabels[o.dataset as keyof typeof datasetLabels] ?? o.dataset}</td>
                        <td className={`${td} text-xs`}>
                          {o.before.verdict} {o.before.codes.join(', ')}
                        </td>
                        <td className={`${td} text-xs`}>
                          {o.after.verdict} {o.after.codes.join(', ')}
                        </td>
                        <td className={td}>{!o.applicable ? '対象外' : `${o.passBefore ? '○' : '×'} → ${o.passAfter ? '○' : '×'}`}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </details>
            </div>
          )}
        </Card>

        <Card title="再実験" description="修正前（対照）と修正後（処置）を、元の研究と同じ市場・同じシードで実行し、逸脱・損益・費用・実行時間を比べます。">
          {data.experiment ? (
            <p className="text-sm">
              <Link href={`/research/studies/${data.experiment.id}`} className="text-white underline underline-offset-2">
                再実験の研究を開く
              </Link>
              <Badge className={`ml-2 ${studyStatusLabels[data.experiment.status].className}`}>{studyStatusLabels[data.experiment.status].label}</Badge>
              {data.experiment.status === 'completed' && <span className="ml-2 text-xs text-ink-300">結果は回帰テストを再実行すると比較表に反映されます。</span>}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="反復数">
                <input className={`${inputClass} w-24`} value={replicates} onChange={(e) => setReplicates(e.target.value)} inputMode="numeric" />
              </Field>
              <Button
                busy={busy === 'experiment'}
                disabled={!['approved_for_simulation', 'simulation_completed'].includes(p.status)}
                onClick={() => {
                  if (!p.isMock && !window.confirm('元の研究のAIモデルを呼び出すため費用が発生します。開始しますか？')) return;
                  call('experiment', `/patches/${id}/experiment`, { replicates: Number(replicates), start: true });
                }}
              >
                再実験を作成して開始
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
