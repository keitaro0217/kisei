'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import ProviderQuickCard from '@/components/research/ProviderQuickCard';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api } from '@/lib/research/client';
import { providerTypeLabels, researchRoles, roleLabels } from '@/lib/research/labels';
import { guideForProvider, PROVIDER_GUIDES } from '@/lib/research/provider-guides';
import type { ProviderDTO, ResearchRole, RoleAssignment } from '@/lib/research/types';

// API連携（かんたん設定）: サービスを選んで APIキーを貼り付け、接続テストに成功したら、使うモデルを選ぶだけで研究に使える。

type Data = {
  providers: ProviderDTO[];
  defaultModel: { providerId: string; model: string } | null;
  roles: Record<ResearchRole, RoleAssignment>;
  encryptionReady: boolean;
};

export default function ApiSettingsPage() {
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Data>('/api-settings')
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;

  const connected = data.providers.filter((p) => p.connection.status === 'connected' && p.researchEnabled);
  const others = data.providers.filter((p) => !guideForProvider(p));
  const providerName = (id: string | null) => data.providers.find((p) => p.id === id)?.name ?? '—';
  const defaultValue = data.defaultModel ? `${data.defaultModel.providerId}::${data.defaultModel.model}` : '';

  const saveDefault = async (value: string) => {
    setError(null);
    setSaved(null);
    try {
      const [providerId, model] = value ? value.split('::') : ['', ''];
      await api('/default-model', { method: 'PUT', body: { providerId: providerId || null, model } });
      setSaved(value ? 'デフォルトのモデルを保存しました。' : 'デフォルトのモデルを解除しました。');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="API連携"
        description="AI サービスの APIキーを貼り付けて「保存して接続テスト」を押すと、接続を確認して使えるモデルを選べるようになります。APIキーはサーバーで暗号化して保存し、画面やログには表示しません。"
        actions={
          <Link href="/research/settings/api/advanced" className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            その他の接続先・詳細管理
          </Link>
        }
      />
      {!data.encryptionReady && (
        <Alert kind="warning" title="APIキーを保存する準備ができていません">
          サーバーの環境変数 API_KEY_ENCRYPTION_KEY（32バイトの鍵）が設定されていないため、APIキーを登録できません。Vercel の「Settings → Environment Variables」で設定し、再デプロイしてください（鍵の作り方は README を参照）。
        </Alert>
      )}
      {error && (
        <Alert kind="error" title="エラー" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {saved && <Alert kind="success" title={saved} onClose={() => setSaved(null)} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {PROVIDER_GUIDES.map((g) => (
          <ProviderQuickCard
            key={g.id}
            guide={g}
            provider={data.providers.find((p) => guideForProvider(p)?.id === g.id) ?? null}
            basic={basic}
            encryptionReady={data.encryptionReady}
            onChanged={load}
          />
        ))}
      </div>

      <Card title="kisei 全体のデフォルトのモデル" description="用途ごとにモデルを割り当てていない場合は、このモデルを使います。研究での利用が有効で、接続テストに成功したモデルから選べます。">
        {connected.length === 0 ? (
          <p className="text-sm text-ink-300">接続済みの AI サービスがありません。上で APIキーを登録して接続テストに成功すると選べるようになります。</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="デフォルトのモデル">
              <select className={`${inputClass} w-96 max-w-full`} value={defaultValue} onChange={(e) => void saveDefault(e.target.value)}>
                <option value="">設定しない</option>
                {connected.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {[...new Set([p.defaultModel, ...(defaultValue.startsWith(`${p.id}::`) ? [data.defaultModel!.model] : [])].filter((m): m is string => Boolean(m)))].map((m) => (
                      <option key={m} value={`${p.id}::${m}`}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Card>

      <Card
        title="用途ごとのモデル"
        description="研究の用途ごとに別のモデルを使えます。割り当てがない用途はデフォルトのモデルを使います。研究プロジェクトでは、作成画面で研究ごとにモデルを選ぶこともできます。"
        actions={
          <Link href="/research/settings/models" className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            用途ごとに割り当てる
          </Link>
        }
      >
        <Table head={['用途', '使うモデル', '説明']}>
          {researchRoles.map((r) => {
            const a = data.roles[r];
            return (
              <tr key={r}>
                <td className={td}>{roleLabels[r].label}</td>
                <td className={`${td} text-xs`}>
                  {a.providerId && a.model ? `${providerName(a.providerId)} / ${a.model}` : data.defaultModel ? `デフォルト（${providerName(data.defaultModel.providerId)} / ${data.defaultModel.model}）` : <span className="text-amber-200">未設定</span>}
                </td>
                <td className={`${td} whitespace-normal text-xs text-ink-200`}>{roleLabels[r].description}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="その他の接続先" description="OpenAI 互換の API やローカル LLM（Ollama）などのカスタム接続先は「その他の接続先・詳細管理」で追加・設定します。">
        {others.length === 0 ? (
          <p className="text-sm text-ink-300">カスタムの接続先はありません。</p>
        ) : (
          <ul className="space-y-1 text-sm text-ink-100">
            {others.map((p) => (
              <li key={p.id}>
                {p.name}（{providerTypeLabels[p.type]}）: {p.connection.status === 'connected' ? '接続済み' : '未接続'}・{p.researchEnabled ? '研究で使う' : '研究では使わない'}
              </li>
            ))}
          </ul>
        )}
        <Link href="/research/settings/api/advanced" className="mt-3 inline-block">
          <Button>その他の接続先・詳細管理を開く</Button>
        </Link>
      </Card>
    </div>
  );
}
