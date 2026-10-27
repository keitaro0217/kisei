'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SetupGuide from '@/components/research/SetupGuide';
import { Alert, Badge, Card, EmptyState, Loading, PageHeader, Stat, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate, formatInt, formatUsd } from '@/lib/research/client';
import { connectionStatusLabels, experimentStatusLabels, providerTypeLabels, researchRoles, roleLabels } from '@/lib/research/labels';
import type { Experiment, ProviderDTO, ResearchRole, RoleAssignment, UsageTotals } from '@/lib/research/types';

type Overview = {
  providers: ProviderDTO[];
  roles: Record<ResearchRole, RoleAssignment>;
  experiments: Experiment[];
  runningCount: number;
  month: UsageTotals;
  globalBudget: number | null;
};

export default function DashboardPage() {
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Overview>('/overview')
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) return <Alert kind="error" title="読み込みに失敗しました">{error}</Alert>;
  if (!data) return <Loading />;
  const providerName = (id: string | null) => data.providers.find((p) => p.id === id)?.name ?? '未設定';

  return (
    <div className="space-y-4">
      <PageHeader title="ダッシュボード" description="AI接続状態・実験の進行状況・API費用の概要" />
      <SetupGuide providers={data.providers} roles={data.roles} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="接続済みプロバイダー" value={`${data.providers.filter((p) => p.connection.status === 'connected').length} / ${data.providers.length}`} />
        <Stat label="実行中の実験" value={data.runningCount} />
        <Stat label="今月の使用額（試算）" value={formatUsd(data.month.costUsd)} sub={data.month.unpricedCalls > 0 ? `料金未設定 ${formatInt(data.month.unpricedCalls)} 件` : undefined} />
        <Stat label="予算残額" value={data.globalBudget === null ? '上限なし' : formatUsd(Math.max(0, data.globalBudget - data.month.costUsd))} sub={`今月の呼び出し ${formatInt(data.month.calls)} 回`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="APIプロバイダーの接続状態" actions={<Link href="/research/settings/api" className="text-xs text-ink-200 hover:text-white">API連携へ →</Link>}>
          {data.providers.length === 0 ? (
            <p className="text-sm text-ink-200">プロバイダーが登録されていません。</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {data.providers.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{p.name}</p>
                    <p className="text-xs text-ink-200">
                      {providerTypeLabels[p.type]} ・ 最終テスト {formatDate(p.connection.testedAt, basic)}
                    </p>
                  </div>
                  <Badge className={connectionStatusLabels[p.connection.status].className}>{connectionStatusLabels[p.connection.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="モデル割り当て" actions={<Link href="/research/settings/models" className="text-xs text-ink-200 hover:text-white">変更 →</Link>}>
          <ul className="divide-y divide-ink-800">
            {researchRoles.map((r) => (
              <li key={r} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-ink-100">{roleLabels[r].label}</span>
                <span className="truncate text-right text-xs text-ink-200">
                  {data.roles[r].model ? `${providerName(data.roles[r].providerId)} / ${data.roles[r].model}` : '未設定'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="最近の実験" actions={<Link href="/research/experiments" className="text-xs text-ink-200 hover:text-white">研究実験へ →</Link>}>
        {data.experiments.length === 0 ? (
          <EmptyState title="実験はまだありません" description="研究実験画面から、取引エージェントの大量エピソード実験を開始できます。" href="/research/experiments" action="実験を作成" />
        ) : (
          <Table head={['実験', 'バージョン', '状態', '進捗', '費用', '更新']}>
            {data.experiments.map((e) => (
              <tr key={e.id}>
                <td className={td}>
                  <Link href={`/research/experiments/${e.id}`} className="font-medium text-white hover:text-white">
                    {e.name}
                  </Link>
                </td>
                <td className={td}>{e.versionLabel}</td>
                <td className={td}>
                  <Badge className={experimentStatusLabels[e.status].className}>{experimentStatusLabels[e.status].label}</Badge>
                </td>
                <td className={td}>
                  {e.completedEpisodes + e.failedEpisodes} / {e.episodes}
                </td>
                <td className={td}>{formatUsd(e.usage.costUsd)}</td>
                <td className={td}>{formatDate(e.updatedAt, basic)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
