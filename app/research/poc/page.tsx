'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { PocProject } from '@/lib/research/poc-types';

// Business Impact / PoC 評価: 企業が導入を判断するための価値（時間・検出・修正案・副作用・監査可能性）を測る。

export default function PocListPage() {
  const router = useRouter();
  const basic = useBasicSettings() ?? undefined;
  const [pocs, setPocs] = useState<PocProject[] | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ pocs: PocProject[] }>('/poc')
      .then((r) => setPocs(r.pocs))
      .catch((e) => setError(e.message));
  }, []);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ poc: PocProject }>('/poc', { method: 'POST', body: { name, purpose } });
      router.push(`/research/poc/${r.poc.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Business Impact / PoC 評価"
        description="作業時間の削減・新たなリスクの検出・修正案の有効性・副作用・監査可能性を測り、導入判断のためのレポートを作ります。人が入力した値は実測／推定を区別し、専門家が確認していない疑いは発見として数えません。"
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="新しい PoC">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="名称" required>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="検証目的">
              <input className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary" className="mt-3" busy={busy} onClick={create}>
            作成
          </Button>
        </Card>
        <Card title="PoC">
          {!pocs ? (
            <Loading />
          ) : (
            <Table head={['名称', '対象の研究', '更新']} empty="PoC はまだありません">
              {pocs.map((p) => (
                <tr key={p.id}>
                  <td className={td}>
                    <Link href={`/research/poc/${p.id}`} className="font-medium text-white underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className={td}>{p.studyIds.length}</td>
                  <td className={td}>{formatDate(p.updatedAt, basic)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
