'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import type { IntentLabel } from '@/lib/research/eval-types';
import type { TestCase, TestDataset } from '@/lib/research/failure-types';
import { datasetLabels, intentLabels } from '@/lib/research/study-labels';
import type { Study } from '@/lib/research/study-types';

// 回帰テストのデータセット。候補を研究者が確認し、期待する趣旨の判定を確定して承認する。

export default function TestCasesPage() {
  const [cases, setCases] = useState<TestCase[] | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [dataset, setDataset] = useState<'' | TestDataset>('');
  const [status, setStatus] = useState<'' | 'candidate' | 'approved' | 'rejected'>('');
  const [normalStudy, setNormalStudy] = useState('');
  const [normalCount, setNormalCount] = useState('20');
  const [drafts, setDrafts] = useState<Record<string, IntentLabel | ''>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (dataset) q.set('dataset', dataset);
    if (status) q.set('status', status);
    return api<{ testCases: TestCase[] }>(`/test-cases?${q}`)
      .then((r) => setCases(r.testCases))
      .catch((e) => setError(e.message));
  }, [dataset, status]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api<{ studies: Study[] }>('/studies')
      .then((r) => setStudies(r.studies.filter((s) => s.frozen)))
      .catch(() => undefined);
  }, []);

  const review = async (t: TestCase, next: 'approved' | 'rejected' | 'candidate') => {
    setError(null);
    try {
      const intent = drafts[t.id] ?? t.expectedIntent ?? '';
      await api(`/test-cases/${t.id}`, { method: 'PATCH', body: { status: next, expectedIntent: intent || null } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const generateNormal = async () => {
    setError(null);
    try {
      const r = await api<{ created: number }>('/test-cases/normal', { method: 'POST', body: { studyId: normalStudy, count: Number(normalCount) } });
      setMessage(`正常な行動のテストケース候補を ${r.created} 件作成しました。`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const counts = (cases ?? []).reduce<Record<string, number>>((a, t) => ((a[t.dataset] = (a[t.dataset] ?? 0) + 1), a), {});

  return (
    <>
      <PageHeader
        title="回帰テストのデータセット"
        description="既知の Failure・正常な行動・閾値付近のケースを、判断の時点の状態と規則の版とともに保存します。形式判定は記録した状態から決定論的に再現できます。期待する趣旨の判定は、AI の推測ではなく研究者が確認して確定します。"
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
        <Card title="正常な行動のケースを追加" description="誤拒否（正常な取引を規則が拒否してしまうこと）を検証するため、受理された・指摘のない判断から無作為に選びます。">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="研究">
              <select className={`${inputClass} w-72`} value={normalStudy} onChange={(e) => setNormalStudy(e.target.value)}>
                <option value="">選んでください</option>
                {studies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.design.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="件数">
              <input className={`${inputClass} w-24`} value={normalCount} onChange={(e) => setNormalCount(e.target.value)} inputMode="numeric" />
            </Field>
            <Button disabled={!normalStudy} onClick={generateNormal}>
              候補を作成
            </Button>
          </div>
        </Card>
        <Card
          title="テストケース"
          description={Object.entries(counts)
            .map(([k, n]) => `${datasetLabels[k as TestDataset]} ${n}件`)
            .join('・')}
          actions={
            <span className="flex gap-2">
              <select className={`${inputClass} w-40`} value={dataset} onChange={(e) => setDataset(e.target.value as typeof dataset)} aria-label="データセット">
                <option value="">すべてのデータセット</option>
                {Object.entries(datasetLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select className={`${inputClass} w-32`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="状態">
                <option value="">すべての状態</option>
                <option value="candidate">候補</option>
                <option value="approved">承認済み</option>
                <option value="rejected">却下</option>
              </select>
            </span>
          }
        >
          {!cases ? (
            <Loading />
          ) : (
            <Table head={['テストケース', 'データセット', '再現条件', '期待する形式判定', '期待する趣旨', '状態', '']} empty="テストケースはありません">
              {cases.map((t) => (
                <tr key={t.id}>
                  <td className={`${td} max-w-xs whitespace-normal text-xs`}>{t.title}</td>
                  <td className={td}>{datasetLabels[t.dataset]}</td>
                  <td className={`${td} text-xs`}>
                    価格 {t.initialState.price}・保有 {t.initialState.position}・未約定 {t.initialState.openOrders.length}
                    <br />
                    行動: {t.action.action ?? '解釈不能'} {t.action.quantity ?? ''}
                  </td>
                  <td className={`${td} text-xs`}>
                    {t.expectedFormal.verdict} {t.expectedFormal.codes.join(', ')}
                  </td>
                  <td className={td}>
                    <select
                      className={`${inputClass} w-40`}
                      value={drafts[t.id] ?? t.expectedIntent ?? ''}
                      onChange={(e) => setDrafts({ ...drafts, [t.id]: e.target.value as IntentLabel | '' })}
                      aria-label="期待する趣旨の判定"
                    >
                      <option value="">未確定</option>
                      {Object.entries(intentLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={td}>
                    {{ candidate: '候補', approved: '承認済み', rejected: '却下' }[t.status]}
                    {t.reviewedBy && <span className="block text-xs text-ink-300">{t.reviewedBy}</span>}
                  </td>
                  <td className={`${td} space-x-1`}>
                    {t.status !== 'approved' && <Button onClick={() => review(t, 'approved')}>承認</Button>}
                    {t.status !== 'rejected' && <Button variant="ghost" onClick={() => review(t, 'rejected')}>却下</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
