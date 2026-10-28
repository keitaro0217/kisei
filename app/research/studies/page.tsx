'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Card, EmptyState, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import { studyStatusLabels } from '@/lib/research/study-labels';
import type { Study } from '@/lib/research/study-types';

export default function StudiesPage() {
  const basic = useBasicSettings() ?? undefined;
  const [studies, setStudies] = useState<Study[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ studies: Study[] }>('/studies')
        .then((r) => setStudies(r.studies))
        .catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <PageHeader
        title="研究プロジェクト"
        description="条文や提示条件だけを変え、同じ市場・同じシードで複数の条件を比較する研究です。開始時に設定を凍結し、そのハッシュを記録します。"
        actions={
          <Link href="/research/studies/new" className="rc-primary inline-flex rounded-md px-3.5 py-1.5 text-sm font-medium">
            新しい研究
          </Link>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="読み込みに失敗しました">
            {error}
          </Alert>
        </div>
      )}
      {studies === null ? (
        <Loading />
      ) : studies.length === 0 ? (
        <EmptyState title="研究はまだありません" description="規則・条文の画面で条文A/Bを作成し、「このペアで研究を作成」から始められます。" href="/research/rules" action="規則・条文へ" />
      ) : (
        <Card>
          <Table head={['研究名', '状態', 'データ', '条件', '反復', 'ステップ', '凍結ハッシュ', '作成日時']}>
            {studies.map((s) => (
              <tr key={s.id}>
                <td className={td}>
                  <Link href={`/research/studies/${s.id}`} className="font-medium text-white underline-offset-2 hover:underline">
                    {s.design.title}
                  </Link>
                </td>
                <td className={td}>
                  <Badge className={studyStatusLabels[s.status].className}>{studyStatusLabels[s.status].label}</Badge>
                </td>
                <td className={td}>
                  {s.isMock ? <Badge className="bg-violet-500/10 text-violet-200 ring-violet-400/30">モックデータ</Badge> : <span className="text-xs">AIモデル</span>}
                </td>
                <td className={td}>{s.design.conditions.length}</td>
                <td className={td}>{s.design.replicates}</td>
                <td className={td}>{s.design.market.steps}</td>
                <td className={`${td} font-mono text-xs`}>{s.frozenHash ? s.frozenHash.slice(0, 12) : '—'}</td>
                <td className={td}>{formatDate(s.createdAt, basic)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
