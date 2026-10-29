'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, Stat, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import type { Failure, FailureCluster, Hypothesis, TestCase } from '@/lib/research/failure-types';
import { categoryOfFailureLabels, datasetLabels, hypothesisStatusLabels, severityLabels } from '@/lib/research/study-labels';

// Failure のクラスターの詳細: 個々の Failure、テストケース化、原因の候補。

type Data = { cluster: FailureCluster; failures: Failure[]; testCases: TestCase[]; hypotheses: Hypothesis[] };

const STATUS_LABEL: Record<Failure['status'], string> = { new: '未確認', confirmed: '確認済み', dismissed: '誤検出' };

export default function ClusterPage() {
  const { fingerprint } = useParams<{ fingerprint: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Data>(`/failures/clusters/${fingerprint}`)
        .then(setData)
        .catch((e) => setError(e.message)),
    [fingerprint],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;
  const c = data.cluster;
  const mock = data.failures.some((f) => f.isMock);

  return (
    <>
      <PageHeader
        title={c.label}
        description={`分類: ${categoryOfFailureLabels[c.category]}・クラスター ID ${c.fingerprint}`}
        actions={
          <Link href="/research/failures" className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            一覧へ
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
      {mock && (
        <div className="mb-4">
          <Alert kind="warning" title="モックデータを含みます">モックエージェントの行動から検出した Failure です。AIの行動に関する発見として扱わないでください。</Alert>
        </div>
      )}
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="件数" value={c.count} sub={`${c.studies} 件の研究`} />
          <Stat label="重大度（初期値）" value={<Badge className={severityLabels[c.severity].className}>{severityLabels[c.severity].label}</Badge>} sub="形式違反=高・趣旨逸脱=中・閾値付近=低" />
          <Stat label="確認状況" value={`${c.confirmed} 確認 / ${c.dismissed} 誤検出`} sub={c.known ? '既知のパターン' : '新規のパターン'} />
          <Stat label="テストケース・仮説" value={`${c.testCases} / ${c.hypotheses}`} />
        </div>

        <Card
          title="原因の候補"
          description="候補は規則・条件の構造から生成します（AIによる推測ではありません）。トレースでの確認は因果の証明ではなく、統制実験の結果だけが「効果を支持」の根拠になります。"
          actions={
            <Button
              variant="primary"
              busy={busy === 'hyp'}
              onClick={() => run('hyp', async () => `${(await api<{ hypotheses: Hypothesis[] }>(`/failures/clusters/${fingerprint}/hypotheses`, { method: 'POST', body: {} })).hypotheses.length} 件の候補を作成しました。`)}
            >
              原因の候補を生成
            </Button>
          }
        >
          <Table head={['候補', '介入', '状態']} empty="候補はまだありません">
            {data.hypotheses.map((h) => (
              <tr key={h.id}>
                <td className={`${td} whitespace-normal`}>
                  <Link href={`/research/hypotheses/${h.id}`} className="font-medium text-white underline-offset-2 hover:underline">
                    {h.title}
                  </Link>
                  <p className="text-xs text-ink-300">{h.description}</p>
                </td>
                <td className={`${td} whitespace-normal text-xs`}>{h.intervention.description}</td>
                <td className={td}>
                  <Badge className={hypothesisStatusLabels[h.status].className}>{hypothesisStatusLabels[h.status].label}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card
          title="修正案（Auto-Patch）"
          description="このクラスターの Failure をもとに、規則文言・定義・判定ロジック・プロンプト・参照文書の修正案をテンプレートから作成します。作成した修正案は研究者の承認を経て、仮想環境でだけ検証されます。"
          actions={
            <Button
              busy={busy === 'patch'}
              onClick={() => run('patch', async () => `${(await api<{ patches: unknown[] }>('/patches', { method: 'POST', body: { fingerprint } })).patches.length} 件の修正案を作成しました（Auto-Patch の画面で確認できます）。`)}
            >
              修正案を作成
            </Button>
          }
        >
          <Link href="/research/patches" className="text-sm underline underline-offset-2">
            Auto-Patch の画面を開く
          </Link>
        </Card>

        <Card
          title="テストケース"
          description="代表的な Failure から、再現条件（判断の時点の状態・規則の版・行動）を抽出します。期待する趣旨の判定は人が確認して確定します。"
          actions={
            <Button busy={busy === 'tc'} onClick={() => run('tc', async () => `${(await api<{ created: number }>(`/failures/clusters/${fingerprint}/test-cases`, { method: 'POST', body: { max: 3 } })).created} 件の候補を作成しました。`)}>
              テストケースの候補を作成
            </Button>
          }
        >
          <Table head={['テストケース', 'データセット', '状態', '期待する形式判定', '期待する趣旨']} empty="テストケースはまだありません">
            {data.testCases.map((t) => (
              <tr key={t.id}>
                <td className={`${td} whitespace-normal`}>
                  <Link href={`/research/test-cases?focus=${t.id}`} className="text-white underline-offset-2 hover:underline">
                    {t.title}
                  </Link>
                </td>
                <td className={td}>{datasetLabels[t.dataset]}</td>
                <td className={td}>{{ candidate: '候補', approved: '承認済み', rejected: '却下' }[t.status]}</td>
                <td className={`${td} text-xs`}>
                  {t.expectedFormal.verdict} {t.expectedFormal.codes.join(', ')}
                </td>
                <td className={td}>{t.expectedIntent ?? '未確定'}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Failure（最大500件）">
          <Table head={['研究・条件', '反復', 'ステップ', '行動', '検出', '状態', '重大度', '']}>
            {data.failures.map((f) => (
              <tr key={f.id}>
                <td className={`${td} text-xs`}>
                  <Link href={`/research/studies/${f.studyId}?condition=${encodeURIComponent(f.conditionId)}&replicate=${f.replicate}&step=${f.step}`} className="underline-offset-2 hover:underline">
                    {f.studyId.slice(0, 8)} / {f.conditionId}
                  </Link>
                </td>
                <td className={td}>{f.replicate}</td>
                <td className={td}>{f.step + 1}</td>
                <td className={`${td} text-xs`}>
                  {f.action.action ?? '解釈不能'} {f.action.quantity ?? ''} {f.action.orderType === 'limit' ? `@${f.action.limitPrice}` : ''}
                </td>
                <td className={`${td} text-xs`}>{f.detectedBy.join(', ')}</td>
                <td className={td}>{STATUS_LABEL[f.status]}</td>
                <td className={td}>
                  <Badge className={severityLabels[f.severity].className}>{severityLabels[f.severity].label}</Badge>
                </td>
                <td className={`${td} space-x-2 text-xs`}>
                  {f.traceId && (
                    <Link href={`/research/traces/${f.traceId}`} className="underline underline-offset-2">
                      トレース
                    </Link>
                  )}
                  {f.status !== 'confirmed' && (
                    <button type="button" className="underline underline-offset-2" onClick={() => run(f.id, async () => (await api(`/failures/${f.id}`, { method: 'PATCH', body: { status: 'confirmed' } }), '確認済みにしました。'))}>
                      確認済み
                    </button>
                  )}
                  {f.status !== 'dismissed' && (
                    <button type="button" className="underline underline-offset-2" onClick={() => run(f.id, async () => (await api(`/failures/${f.id}`, { method: 'PATCH', body: { status: 'dismissed' } }), '誤検出にしました。'))}>
                      誤検出
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
