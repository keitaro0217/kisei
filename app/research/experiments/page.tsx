'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import MarketFields, { defaultMarketForm, marketPayload, validateMarket, type MarketForm } from '@/components/research/MarketFields';
import SetupGuide, { setupSteps } from '@/components/research/SetupGuide';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, ApiError, formatDate, formatUsd } from '@/lib/research/client';
import { experimentStatusLabels } from '@/lib/research/labels';
import type { Experiment, ExperimentVersion, ProviderDTO, ResearchRole, RoleAssignment } from '@/lib/research/types';

export default function ExperimentsPage() {
  const router = useRouter();
  const basic = useBasicSettings() ?? undefined;
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [versions, setVersions] = useState<ExperimentVersion[]>([]);
  const [setup, setSetup] = useState<{ providers: ProviderDTO[]; roles: Record<ResearchRole, RoleAssignment> } | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [episodes, setEpisodes] = useState('100');
  const [market, setMarket] = useState<MarketForm>(defaultMarketForm);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fetchAll = () =>
      Promise.all([
        api<{ experiments: Experiment[]; versions: ExperimentVersion[] }>('/experiments'),
        api<{ providers: ProviderDTO[]; roles: Record<ResearchRole, RoleAssignment> }>('/overview'),
      ]);
    const apply = ([e, o]: Awaited<ReturnType<typeof fetchAll>>) => {
      setExperiments(e.experiments);
      setVersions(e.versions);
      setSetup(o);
    };
    fetchAll()
      .then(apply)
      .catch((e) => setError({ title: '読み込みに失敗しました', message: e.message }));
    const t = setInterval(() => fetchAll().then(apply).catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    const invalid = !name.trim() ? '実験名を入力してください' : !/^\d+$/.test(episodes) || Number(episodes) < 1 || Number(episodes) > 100000 ? 'エピソード数は1〜100,000の整数で入力してください' : validateMarket(market);
    if (invalid) {
      setError({ title: '入力値を確認してください', message: invalid });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ experiment: Experiment }>('/experiments', {
        method: 'POST',
        body: { name: name.trim(), description, episodes: Number(episodes), ...marketPayload(market) },
      });
      router.push(`/research/experiments/${res.experiment.id}`);
    } catch (e) {
      setError({ title: e instanceof ApiError && e.label ? e.label : '実験を開始できませんでした', message: e instanceof Error ? e.message : '' });
      setBusy(false);
    }
  };

  const ready = setup ? setupSteps(setup.providers, setup.roles).every((s) => s.done) : false;

  return (
    <div className="space-y-4">
      <PageHeader
        title="研究実験"
        description="取引エージェントによる大量エピソード実験を実行・管理します。開始時点のモデル設定は固定され、実行中に変更されません。"
        actions={
          !creating && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              ＋ 新しい実験
            </Button>
          )
        }
      />
      {setup && <SetupGuide providers={setup.providers} roles={setup.roles} compact />}
      {error && <Alert kind="error" title={error.title} onClose={() => setError(null)}>{error.message}</Alert>}
      {creating && (
        <Card title="新しい実験">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="実験名" required>
              <input className={inputClass} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="エピソード数" required hint="1〜100,000">
              <input className={inputClass} inputMode="numeric" value={episodes} onChange={(e) => setEpisodes(e.target.value)} />
            </Field>
            <Field label="メモ">
              <input className={inputClass} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <MarketFields form={market} onChange={setMarket} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {!ready && <span className="mr-auto text-xs text-amber-300">接続設定が未完了のため、開始時にエラーになる可能性があります。</span>}
            <Button onClick={() => setCreating(false)}>キャンセル</Button>
            <Button variant="primary" onClick={create} busy={busy}>
              実験を開始
            </Button>
          </div>
        </Card>
      )}
      <Card title="実験一覧">
        {!experiments ? (
          <Loading />
        ) : (
          <Table head={['実験', 'バージョン', '状態', '進捗', '失敗', '費用', '作成']} empty="実験はまだありません">
            {experiments.map((e) => (
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
                <td className={td}>{e.failedEpisodes}</td>
                <td className={td}>{formatUsd(e.usage.costUsd)}</td>
                <td className={td}>{formatDate(e.createdAt, basic)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="実験バージョン" description="モデル・推論設定・プロンプト・ツール構成・市場条件の組み合わせごとに付番されます。">
        <Table head={['バージョン', 'ハッシュ', '構成', '初回作成']} empty="まだありません">
          {versions.map((v) => (
            <tr key={v.hash}>
              <td className={td}>{v.label}</td>
              <td className={`${td} font-mono text-xs`}>{v.hash}</td>
              <td className={td}>{v.summary}</td>
              <td className={td}>{formatDate(v.createdAt, basic)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
