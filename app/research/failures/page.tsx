'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { FailureCluster } from '@/lib/research/failure-types';
import { categoryOfFailureLabels, confidenceLabels, severityLabels } from '@/lib/research/study-labels';
import type { Study } from '@/lib/research/study-types';

// Failure Library: 逸脱の疑いを特徴ごとに分類し、テストケース・原因分析につなげる。

export default function FailuresPage() {
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<{ clusters: FailureCluster[]; total: number; facets?: { ruleKeys: string[]; industries: string[]; models: string[]; causes: string[] } } | null>(null);
  // 検索条件（規則・業界・逸脱分類・原因候補・モデル・重大度・修正状況・検証結果・文字列）
  const [q, setQ] = useState<Record<string, string>>({});
  const [studies, setStudies] = useState<Study[]>([]);
  const [studyId, setStudyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'new' | 'known'>('all');

  const load = useCallback(() => {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return api<NonNullable<typeof data>>(`/failures${params.size ? `?${params}` : ''}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [q]);
  useEffect(() => {
    load();
    api<{ studies: Study[] }>('/studies')
      .then((r) => setStudies(r.studies.filter((s) => s.status === 'completed' || s.status === 'stopped' || s.status === 'paused')))
      .catch(() => undefined);
  }, [load]);

  const detect = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await api<{ added: number; detected: number }>('/failures/detect', { method: 'POST', body: { studyId } });
      setMessage(`${r.detected} 件の逸脱の疑いを検出し、新たに ${r.added} 件を登録しました（登録済みの判断は重複して登録しません）。`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clusters = (data?.clusters ?? []).filter((c) => filter === 'all' || (filter === 'known' ? c.known : !c.known));

  return (
    <>
      <PageHeader
        title="Failure Library"
        description="研究で見つかった逸脱の疑い（形式違反・趣旨逸脱の疑い・閾値付近の行動・外れ値・評価の不一致・評価不能）を、規則・コード・行動の種類・市場の局面で分類します。代表例をテストケースにし、原因の候補を統制実験で検証できます。"
        actions={
          <Link href="/research/test-cases" className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            回帰テストのデータセット
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
      {message && (
        <div className="mb-4">
          <Alert kind="success" title={message} onClose={() => setMessage(null)} />
        </div>
      )}
      <div className="space-y-6">
        <Card title="Failure の検出" description="完了したセッションの判断を、規則エンジン・趣旨逸脱の事前基準・Judge・人の評価の結果から検出します。人が「趣旨に適合」と評価した判断は、趣旨逸脱・閾値付近としては登録しません。">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="研究">
              <select className={`${inputClass} w-80`} value={studyId} onChange={(e) => setStudyId(e.target.value)}>
                <option value="">選んでください</option>
                {studies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.design.title}
                    {s.isMock ? '（モック）' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="primary" busy={busy} disabled={!studyId} onClick={detect}>
              検出して登録
            </Button>
          </div>
        </Card>

        <Card title="検索・絞り込み" description="構造化された属性と、ラベル・規則・コードの文字列で検索します（意味検索は使っていません）。">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="キーワード">
              <input className={`${inputClass} w-48`} value={q.q ?? ''} onChange={(e) => setQ({ ...q, q: e.target.value })} placeholder="例: SPOOF" />
            </Field>
            {(
              [
                ['ruleKey', '規則', data?.facets?.ruleKeys ?? []],
                ['industry', '業界', data?.facets?.industries ?? []],
                ['category', '逸脱分類', Object.keys(categoryOfFailureLabels)],
                ['cause', '原因候補', data?.facets?.causes ?? []],
                ['model', 'モデル', data?.facets?.models ?? []],
                ['severity', '重大度', ['high', 'medium', 'low']],
                ['fixStatus', '修正状況', ['none', 'proposed', 'approved', 'recommended']],
                ['verification', '検証結果', ['not_verified', 'PASS', 'FAIL', 'INCONCLUSIVE', 'REVIEW_REQUIRED', 'hypothesis_supported', 'hypothesis_refuted']],
              ] as [string, string, string[]][]
            ).map(([key, label, options]) => (
              <Field key={key} label={label}>
                <select className={`${inputClass} w-40`} value={q[key] ?? ''} onChange={(e) => setQ({ ...q, [key]: e.target.value })}>
                  <option value="">すべて</option>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {key === 'category' ? categoryOfFailureLabels[o as keyof typeof categoryOfFailureLabels] : o}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <Button onClick={() => setQ({})}>条件をクリア</Button>
          </div>
        </Card>

        <Card
          title={`クラスター${data ? `（${data.clusters.length} 件・Failure 全 ${data.total} 件）` : ''}`}
          actions={
            <select className={`${inputClass} w-40`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="新規／既知で絞り込み">
              <option value="all">すべて</option>
              <option value="new">新規のみ</option>
              <option value="known">既知のみ</option>
            </select>
          }
        >
          {!data ? (
            <Loading />
          ) : (
            <Table head={['クラスター', '分類', '重大度', '確信度', '件数', '研究', '新規／既知', '修正状況', '検証', '最終検出']} empty="該当する Failure はありません">
              {clusters.map((c) => (
                <tr key={c.fingerprint}>
                  <td className={`${td} max-w-md whitespace-normal`}>
                    <Link href={`/research/failures/${c.fingerprint}`} className="font-medium text-white underline-offset-2 hover:underline">
                      {c.label}
                    </Link>
                  </td>
                  <td className={td}>{categoryOfFailureLabels[c.category]}</td>
                  <td className={td}>
                    <Badge className={severityLabels[c.severity].className}>{severityLabels[c.severity].label}</Badge>
                  </td>
                  <td className={`${td} text-xs`}>{c.confidence ? confidenceLabels[c.confidence] : '—'}</td>
                  <td className={td}>{c.count}</td>
                  <td className={td}>{c.studies}</td>
                  <td className={td}>{c.known ? '既知' : '新規'}</td>
                  <td className={`${td} text-xs`}>{c.fixStatus ?? '—'}</td>
                  <td className={`${td} text-xs`}>{c.verification ?? '—'}</td>
                  <td className={td}>{formatDate(c.lastSeen, basic)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
