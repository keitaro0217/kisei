'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import { studyStatusLabels } from '@/lib/research/study-labels';
import type { Study } from '@/lib/research/study-types';

// 多層評価・人による評価の入口（研究ごとに評価する）。

export default function EvaluationIndexPage() {
  const [studies, setStudies] = useState<Study[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ studies: Study[] }>('/studies')
      .then((r) => setStudies(r.studies.filter((s) => s.frozen)))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHeader title="多層評価・人の評価" description="研究ごとに、形式適合・規制趣旨・経済/業務影響・証拠の質・評価器の信頼性を評価します。LLM Judge の実行と人による評価（ゴールドデータの作成）もここから行います。" />
      {error && <Alert kind="error" title="読み込みに失敗しました">{error}</Alert>}
      <Card>
        {!studies ? (
          <Loading />
        ) : (
          <Table head={['研究', '状態', 'データ', '']} empty="開始済みの研究がありません">
            {studies.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.design.title}</td>
                <td className={td}>
                  <Badge className={studyStatusLabels[s.status].className}>{studyStatusLabels[s.status].label}</Badge>
                </td>
                <td className={td}>{s.isMock ? 'モックデータ' : 'AIモデル'}</td>
                <td className={`${td} space-x-3`}>
                  <Link href={`/research/studies/${s.id}/evaluation`} className="text-white underline underline-offset-2">
                    多層評価
                  </Link>
                  <Link href={`/research/studies/${s.id}/review`} className="underline underline-offset-2">
                    人による評価
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
