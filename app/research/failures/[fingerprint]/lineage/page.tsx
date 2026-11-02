'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Loading, PageHeader, Stat } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { Lineage } from '@/lib/server/research/lineage';

// 問題の全履歴: 発見 → 人の確認 → 原因仮説と検証 → 修正案 → 承認 → 回帰テスト → 再実験 → 提案の承認

export default function LineagePage() {
  const { fingerprint } = useParams<{ fingerprint: string }>();
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Lineage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ lineage: Lineage }>(`/failures/clusters/${fingerprint}/lineage`)
      .then((r) => setData(r.lineage))
      .catch((e) => setError(e.message));
  }, [fingerprint]);
  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;
  const s = data.summary;
  const stageLabel = Object.fromEntries(data.stages.map((x) => [x.stage, x.label])) as Record<string, string>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="問題の全履歴"
        description="この問題（Failure のクラスター）の発見から、原因の検証・修正案・承認・回帰テスト・再実験までを、保存済みの記録からたどります。"
        actions={
          <Link href={`/research/failures/${fingerprint}`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            クラスターの詳細へ
          </Link>
        }
      />
      {data.includesMock && (
        <Alert kind="warning" title="モックのデータを含みます">
          モック（決定論的なエージェント）の研究・再実験を含むため、AI の行動に関する研究結果として解釈・引用しないでください。
        </Alert>
      )}
      <Alert kind={data.verified ? 'success' : 'info'} title={data.verified ? '改善の検証まで完了しています（回帰テスト PASS・再実験あり）' : '改善の検証はまだ完了していません'}>
        {data.verified ? '修正前後を同じ条件で比較した結果があります。副作用（正常な行動の誤拒否・損益）も確認してください。' : '下の段階のうち、未完了のものを順に進めてください。'}
      </Alert>

      <Card title="段階">
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {data.stages.map((x, i) => (
            <li key={x.stage} className={`rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${x.done ? 'bg-white/10 text-white ring-white/20' : 'text-ink-300 ring-white/10'}`}>
              <span className="mr-1 text-ink-400">{i + 1}.</span>
              {x.label}
              <span className="ml-1">{x.done ? '✓' : '—'}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="検出" value={`${s.failures.toLocaleString()} 件`} sub={`${s.studies.length} 件の研究・確認 ${s.confirmed} / 除外 ${s.dismissed}`} />
        <Stat label="原因仮説" value={`${s.hypotheses.total} 件`} sub={`検証済み ${s.hypotheses.tested}・効果あり ${s.hypotheses.supported}`} />
        <Stat label="修正案" value={`${s.patches.total} 件`} sub={`承認 ${s.patches.approved}・提案 ${s.patches.recommended}`} />
        <Stat label="回帰テスト" value={s.regression.latestGate ?? '未実施'} sub={`${s.regression.runs} 回（PASS ${s.regression.pass}）・再実験 ${s.reexperiments}`} />
      </div>

      <Card title="時系列" description="監査ログ（改ざん検知つき）と各記録の日時です。">
        <ol className="space-y-3">
          {data.events.map((e, i) => (
            <li key={i} className="border-l border-white/15 pl-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
                <span>{formatDate(e.at, basic)}</span>
                <Badge className="bg-white/10 text-ink-100 ring-white/15">{e.stage === 'audit' ? '操作' : (stageLabel[e.stage] ?? e.stage)}</Badge>
                {e.by && <span>{e.by}</span>}
              </div>
              <p className="mt-1 text-sm text-ink-50">{e.href ? <Link href={e.href} className="underline underline-offset-2">{e.title}</Link> : e.title}</p>
              {e.detail && <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-200">{e.detail}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
