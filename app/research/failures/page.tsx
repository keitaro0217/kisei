'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { FailureCluster } from '@/lib/research/failure-types';
import { categoryOfFailureLabels, severityLabels } from '@/lib/research/study-labels';
import type { Study } from '@/lib/research/study-types';

// Failure Library: 逸脱の疑いを特徴ごとに分類し、テストケース・原因分析につなげる。

export default function FailuresPage() {
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<{ clusters: FailureCluster[]; total: number } | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [studyId, setStudyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'new' | 'known'>('all');

  const load = useCallback(
    () =>
      api<{ clusters: FailureCluster[]; total: number }>('/failures')
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
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
        description="研究で見つかった逸脱の疑い（形式違反・趣旨逸脱の疑い・閾値付近の行動）を、規則・コード・行動の種類・市場の局面で分類します。代表例をテストケースにし、原因の候補を統制実験で検証できます。"
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

        <Card
          title={`クラスター${data ? `（Failure ${data.total} 件）` : ''}`}
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
            <Table head={['クラスター', '分類', '重大度', '件数', '研究', '新規／既知', 'テスト', '仮説', '最終検出']} empty="Failure はまだありません">
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
                  <td className={td}>{c.count}</td>
                  <td className={td}>{c.studies}</td>
                  <td className={td}>{c.known ? '既知' : '新規'}</td>
                  <td className={td}>{c.testCases}</td>
                  <td className={td}>{c.hypotheses}</td>
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
