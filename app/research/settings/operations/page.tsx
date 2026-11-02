'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, Stat, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { Job } from '@/lib/server/jobs/queue';

// 運用状況: データベース・マイグレーション・バックグラウンドジョブ・実行中の研究・監査ログの改ざん検知。

type Ops = {
  database: { kind: 'postgres' | 'pglite'; latencyMs: number; migrations: { id: string; appliedAt: string }[]; pendingMigrations: string[] };
  jobs: { counts: Record<string, number>; recentFailed: Job[] };
  studies: { running: number; stalled: { id: string; title: string; lastActivityAt: string | null; remaining: number }[]; all: { id: string; title: string; state: string; remaining: number }[] };
  audit: { ok: boolean; checked: number; brokenAt: number | null };
  tables: { table: string; rows: number }[];
  checkedAt: string;
};

const livenessLabels: Record<string, string> = { active: '処理中', waiting: '処理待ち', stalled: '停止', idle: '処理なし' };

export default function OperationsPage() {
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Ops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Ops>('/ops')
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;

  const jobAction = async (jobId: string, action: 'retry' | 'cancel') => {
    setBusy(`${jobId}:${action}`);
    try {
      await api('/ops', { method: 'POST', body: { jobId, action } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const c = data.jobs.counts;

  return (
    <div className="space-y-6">
      <PageHeader title="運用状況" description={`データベース・バックグラウンドジョブ・実行中の研究・監査ログの状態です（${formatDate(data.checkedAt, basic)} 時点、15秒ごとに更新）。`} />
      {error && (
        <Alert kind="error" title="エラー" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {data.database.kind === 'pglite' && (
        <Alert kind="warning" title="組み込みのデータベースで動作しています">
          DATABASE_URL が設定されていないため、ローカル用の組み込み Postgres を使っています。本番では PostgreSQL（Neon など）を設定してください。
        </Alert>
      )}
      {!data.audit.ok && (
        <Alert kind="error" title="監査ログの改ざんを検出しました">
          連番 {data.audit.brokenAt} 以降の記録がハッシュの連鎖と一致しません。データベースへの直接の変更がなかったか確認してください。
        </Alert>
      )}
      {data.studies.stalled.length > 0 && (
        <Alert kind="warning" title={`処理が止まっている研究が ${data.studies.stalled.length} 件あります`}>
          研究の画面を開くと再開を試みます。続く場合は環境変数 CRON_SECRET と Vercel Cron の設定を確認してください。
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="データベース" value={data.database.kind === 'postgres' ? 'PostgreSQL' : '組み込み'} sub={`応答 ${data.database.latencyMs} ms`} />
        <Stat label="スキーマ" value={`${data.database.migrations.length} 件適用`} sub={data.database.pendingMigrations.length ? `未適用 ${data.database.pendingMigrations.length} 件` : '最新'} />
        <Stat label="ジョブ" value={`待機 ${c.queued ?? 0} / 実行中 ${c.running ?? 0}`} sub={`失敗 ${c.failed ?? 0} 件・リース切れ ${c.stuck ?? 0} 件`} />
        <Stat label="監査ログ" value={data.audit.ok ? '改ざんなし' : '不一致あり'} sub={`${data.audit.checked.toLocaleString()} 件を検証`} />
      </div>

      <Card title="実行中の研究" description="セッションのリースと最終更新から、実際に処理が進んでいるかを判定します。">
        <Table head={['研究', '状態', '残りのセッション']} empty="実行中の研究はありません。">
          {data.studies.all.map((s) => (
            <tr key={s.id}>
              <td className={td}>
                <Link href={`/research/studies/${s.id}`} className="underline">
                  {s.title}
                </Link>
              </td>
              <td className={td}>
                <Badge className={s.state === 'stalled' ? 'bg-amber-500/15 text-amber-200 ring-amber-400/30' : 'bg-white/10 text-ink-100 ring-white/15'}>{livenessLabels[s.state] ?? s.state}</Badge>
              </td>
              <td className={td}>{s.remaining}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="失敗したジョブ" description="再試行の上限に達したジョブです。原因を確認してから再実行してください。">
        <Table head={['種類', '試行', '最後のエラー', '更新', '']} empty="失敗したジョブはありません。">
          {data.jobs.recentFailed.map((j) => (
            <tr key={j.id}>
              <td className={`${td} text-xs`}>{j.kind}</td>
              <td className={td}>
                {j.attempts}/{j.maxAttempts}
              </td>
              <td className={`${td} whitespace-normal text-xs text-ink-200`}>{j.lastError ?? '—'}</td>
              <td className={`${td} text-xs`}>{formatDate(j.updatedAt, basic)}</td>
              <td className={td}>
                <Button busy={busy === `${j.id}:retry`} onClick={() => jobAction(j.id, 'retry')}>
                  再実行
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="適用済みのマイグレーション">
          <ul className="space-y-1 text-xs text-ink-200">
            {data.database.migrations.map((m) => (
              <li key={m.id}>
                {m.id}（{formatDate(m.appliedAt, basic)}）
              </li>
            ))}
          </ul>
        </Card>
        <Card title="テーブルの行数（概算）">
          <ul className="space-y-1 text-xs text-ink-200">
            {data.tables.map((t) => (
              <li key={t.table}>
                {t.table}: {t.rows.toLocaleString()}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
