'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, inputClass, Loading, NoticeBar, PageHeader, Table, td, type Notice } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate, formatUsd } from '@/lib/research/client';
import { experimentStatusLabels } from '@/lib/research/labels';
import type { AppSettings, ExecutionSettings, Experiment, ProviderDTO } from '@/lib/research/types';

const fetchAll = () =>
  Promise.all([
    api<{ settings: AppSettings }>('/settings'),
    api<{ providers: ProviderDTO[] }>('/providers'),
    api<{ experiments: Experiment[] }>('/experiments'),
  ]);

type ProviderDraft = { timeoutMs: string; maxRetries: string; maxConcurrency: string };

export default function ExecutionSettingsPage() {
  const basic = useBasicSettings() ?? undefined;
  const [exec, setExec] = useState<Record<keyof ExecutionSettings, string> | null>(null);
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback(([s, p, e]: Awaited<ReturnType<typeof fetchAll>>) => {
    const x = s.settings.execution;
    setExec({ episodeConcurrency: String(x.episodeConcurrency), episodeRetries: String(x.episodeRetries), maxConsecutiveFailures: String(x.maxConsecutiveFailures) });
    setProviders(p.providers);
    setDrafts(Object.fromEntries(p.providers.map((pr) => [pr.id, { timeoutMs: String(pr.timeoutMs), maxRetries: String(pr.maxRetries), maxConcurrency: String(pr.maxConcurrency) }])));
    setExperiments(e.experiments);
  }, []);
  const load = useCallback(() => fetchAll().then(apply), [apply]);

  useEffect(() => {
    fetchAll()
      .then(apply)
      .catch((e) => setNotice({ kind: 'error', title: '読み込みに失敗しました', message: e.message }));
  }, [apply]);

  const fail = (e: unknown) => setNotice({ kind: 'error', title: '保存できませんでした', message: e instanceof Error ? e.message : undefined });

  const saveExec = async () => {
    if (!exec) return;
    const ok = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
    if (!ok(exec.episodeConcurrency, 1, 64) || !ok(exec.episodeRetries, 0, 10) || !ok(exec.maxConsecutiveFailures, 1, 1000)) {
      setNotice({ kind: 'error', title: '入力値を確認してください', message: '並列数は1〜64、再試行は0〜10、連続失敗の上限は1〜1000の整数です。' });
      return;
    }
    setBusy('exec');
    try {
      await api('/settings', { method: 'PUT', body: { execution: Object.fromEntries(Object.entries(exec).map(([k, v]) => [k, Number(v)])) } });
      setNotice({ kind: 'success', title: '実行設定を保存しました', message: '新しく開始する実験から適用されます。' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const saveProvider = async (id: string) => {
    const d = drafts[id];
    setBusy(id);
    try {
      const res = await api<{ provider: ProviderDTO }>(`/providers/${id}`, {
        method: 'PATCH',
        body: { timeoutMs: Number(d.timeoutMs), maxRetries: Number(d.maxRetries), maxConcurrency: Number(d.maxConcurrency) },
      });
      setProviders((list) => list.map((p) => (p.id === id ? res.provider : p)));
      setNotice({ kind: 'success', title: `「${res.provider.name}」の実行設定を保存しました` });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const action = async (id: string, act: 'pause' | 'resume' | 'stop') => {
    setBusy(`${id}-${act}`);
    try {
      await api(`/experiments/${id}/actions`, { method: 'POST', body: { action: act } });
      await load();
    } catch (e) {
      setNotice({ kind: 'error', title: '操作できませんでした', message: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const jobs = experiments.filter((e) => ['running', 'pausing', 'paused', 'stopping'].includes(e.status));

  return (
    <div className="space-y-4">
      <PageHeader title="実行設定" description="大量エピソード実行時の並列数・タイムアウト・再試行と、実験ジョブを管理します。" />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      {!exec ? (
        <Loading />
      ) : (
        <>
          <Card title="実験の実行設定" description="実験開始時にスナップショットへ固定されます。">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="並列エピソード数" hint="1つの実験で同時に実行するエピソード数（1〜64）">
                <input className={inputClass} inputMode="numeric" value={exec.episodeConcurrency} onChange={(e) => setExec({ ...exec, episodeConcurrency: e.target.value })} />
              </Field>
              <Field label="エピソード再試行回数" hint="一時的な障害で失敗したエピソードのやり直し回数">
                <input className={inputClass} inputMode="numeric" value={exec.episodeRetries} onChange={(e) => setExec({ ...exec, episodeRetries: e.target.value })} />
              </Field>
              <Field label="連続失敗の上限" hint="この回数連続で失敗したら実験を一時停止">
                <input className={inputClass} inputMode="numeric" value={exec.maxConsecutiveFailures} onChange={(e) => setExec({ ...exec, maxConsecutiveFailures: e.target.value })} />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={saveExec} busy={busy === 'exec'}>
                保存
              </Button>
            </div>
          </Card>

          <Card title="プロバイダーごとの通信設定" description="タイムアウト・API呼び出しの再試行回数・同時実行数。">
            <Table head={['プロバイダー', 'タイムアウト（ミリ秒）', '再試行回数', '同時実行数', '']} empty="プロバイダーが登録されていません">
              {providers.map((p) => {
                const d = drafts[p.id];
                const set = (k: keyof ProviderDraft, v: string) => setDrafts({ ...drafts, [p.id]: { ...d, [k]: v } });
                return (
                  <tr key={p.id}>
                    <td className={td}>{p.name}</td>
                    <td className={td}>
                      <input className={`${inputClass} w-28`} value={d.timeoutMs} onChange={(e) => set('timeoutMs', e.target.value)} aria-label="タイムアウト" />
                    </td>
                    <td className={td}>
                      <input className={`${inputClass} w-20`} value={d.maxRetries} onChange={(e) => set('maxRetries', e.target.value)} aria-label="再試行回数" />
                    </td>
                    <td className={td}>
                      <input className={`${inputClass} w-20`} value={d.maxConcurrency} onChange={(e) => set('maxConcurrency', e.target.value)} aria-label="同時実行数" />
                    </td>
                    <td className={td}>
                      <Button onClick={() => saveProvider(p.id)} busy={busy === p.id}>
                        保存
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          <Card title="実験ジョブ管理" description="実行中・一時停止中の実験。一時停止しても研究条件は保持され、再開できます。">
            <Table head={['実験', '状態', '進捗', '費用', '更新', '操作']} empty="実行中・一時停止中の実験はありません">
              {jobs.map((e) => (
                <tr key={e.id}>
                  <td className={td}>
                    <Link href={`/research/experiments/${e.id}`} className="font-medium text-white hover:text-white">
                      {e.name}
                    </Link>
                  </td>
                  <td className={td}>
                    <Badge className={experimentStatusLabels[e.status].className}>{experimentStatusLabels[e.status].label}</Badge>
                  </td>
                  <td className={td}>
                    {e.completedEpisodes + e.failedEpisodes} / {e.episodes}
                  </td>
                  <td className={td}>{formatUsd(e.usage.costUsd)}</td>
                  <td className={td}>{formatDate(e.updatedAt, basic)}</td>
                  <td className={`${td} space-x-1`}>
                    {e.status === 'running' && (
                      <Button onClick={() => action(e.id, 'pause')} busy={busy === `${e.id}-pause`}>
                        一時停止
                      </Button>
                    )}
                    {e.status === 'paused' && (
                      <Button onClick={() => action(e.id, 'resume')} busy={busy === `${e.id}-resume`}>
                        再開
                      </Button>
                    )}
                    {(e.status === 'running' || e.status === 'paused') && (
                      <Button variant="danger" onClick={() => action(e.id, 'stop')} busy={busy === `${e.id}-stop`}>
                        停止
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
