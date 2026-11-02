'use client';

import { useState } from 'react';
import { api, formatDate } from '@/lib/research/client';
import { connectionStatusLabels } from '@/lib/research/labels';
import { chatModels, type ProviderGuide } from '@/lib/research/provider-guides';
import type { BasicSettings, ConnectionTestResult, ProviderDTO } from '@/lib/research/types';
import { Alert, Badge, Button, Card, Field, inputClass } from './ui';

// AI サービス1件のカード: 接続状態・APIキー（マスク表示）・使用モデル・最終確認・研究での利用・接続テスト・キーの変更／削除・詳細設定。
// APIキーは入力欄からサーバーへ送るだけで、保存後に画面へ返されることはない。

type Msg = { kind: 'success' | 'error' | 'info'; text: string } | null;

function TestSteps({ result }: { result: ConnectionTestResult }) {
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {result.steps.map((s) => (
        <li key={s.key} className={s.status === 'failed' ? 'text-rose-300' : s.status === 'ok' ? 'text-ink-100' : 'text-ink-400'}>
          {s.status === 'ok' ? '✓' : s.status === 'failed' ? '✕' : '－'} {s.label}
          {s.message && <span className="text-ink-300">: {s.message}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function ProviderQuickCard({
  guide,
  provider,
  basic,
  encryptionReady,
  onChanged,
}: {
  guide: ProviderGuide;
  provider: ProviderDTO | null;
  basic?: BasicSettings;
  encryptionReady: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [adv, setAdv] = useState(() => ({
    timeoutMs: String(provider?.timeoutMs ?? 60000),
    maxRetries: String(provider?.maxRetries ?? 2),
    maxConcurrency: String(provider?.maxConcurrency ?? 4),
    monthlyBudgetUsd: provider?.monthlyBudgetUsd === null || provider?.monthlyBudgetUsd === undefined ? '' : String(provider.monthlyBudgetUsd),
  }));

  const status = provider ? connectionStatusLabels[provider.connection.status] : connectionStatusLabels.unconfigured;
  const models = provider ? chatModels(guide, provider.models) : [];
  const modelOptions = provider?.defaultModel && !models.some((m) => m.id === provider.defaultModel) ? [{ id: provider.defaultModel, displayName: null }, ...models] : models;
  const showKeyInput = !provider?.hasApiKey || editingKey || provider.apiKeyReadable === false;

  const run = async (key: string, fn: () => Promise<Msg | void>) => {
    setBusy(key);
    setMsg(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
      await onChanged();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run('connect', async () => {
      if (!apiKey.trim()) return { kind: 'error', text: 'APIキーを貼り付けてください。' };
      const r = await api<{ provider: ProviderDTO; result: ConnectionTestResult }>('/providers/quick', { method: 'POST', body: { guide: guide.id, apiKey: apiKey.trim() } });
      // 入力欄のキーはすぐに消す（画面に残さない）
      setApiKey('');
      setEditingKey(false);
      setResult(r.result);
      return r.result.ok
        ? { kind: 'success', text: `接続できました。モデル「${r.result.model}」を使います（下で変更できます）。` }
        : { kind: 'error', text: `APIキーは暗号化して保存しましたが、接続テストに失敗しました。${r.result.message}` };
    });

  const test = (model?: string) =>
    run('test', async () => {
      const r = await api<{ result: ConnectionTestResult }>(`/providers/${provider!.id}/test`, { method: 'POST', body: model ? { model } : {} });
      setResult(r.result);
      return r.result.ok ? { kind: 'success', text: '接続テストに成功しました。' } : { kind: 'error', text: r.result.message ?? '接続テストに失敗しました。' };
    });

  const changeModel = (model: string) =>
    run('model', async () => {
      await api(`/providers/${provider!.id}`, { method: 'PATCH', body: { defaultModel: model } });
      // モデルを変えたら、そのモデルで使えるかをすぐ確認する（最小限のリクエスト1回）
      const r = await api<{ result: ConnectionTestResult }>(`/providers/${provider!.id}/test`, { method: 'POST', body: { model } });
      setResult(r.result);
      return r.result.ok ? { kind: 'success', text: `モデルを「${model}」に変更し、接続を確認しました。` } : { kind: 'error', text: `モデルを変更しましたが、接続テストに失敗しました。${r.result.message}` };
    });

  const toggleResearch = (enabled: boolean) =>
    run('research', async () => {
      await api(`/providers/${provider!.id}`, { method: 'PATCH', body: { researchEnabled: enabled } });
      return { kind: 'success', text: enabled ? '研究での利用を有効にしました。' : '研究での利用を無効にしました（実験・評価では使われません）。' };
    });

  const removeKey = () => {
    if (!window.confirm(`${guide.label} の APIキーを削除しますか？削除すると、このサービスを使う研究・評価は開始できなくなります。`)) return;
    void run('delete', async () => {
      await api(`/providers/${provider!.id}/api-key`, { method: 'DELETE' });
      setResult(null);
      return { kind: 'info', text: 'APIキーを削除しました。' };
    });
  };

  const saveAdvanced = () =>
    run('advanced', async () => {
      await api(`/providers/${provider!.id}`, {
        method: 'PATCH',
        body: {
          timeoutMs: Number(adv.timeoutMs),
          maxRetries: Number(adv.maxRetries),
          maxConcurrency: Number(adv.maxConcurrency),
          monthlyBudgetUsd: adv.monthlyBudgetUsd === '' ? null : Number(adv.monthlyBudgetUsd),
        },
      });
      return { kind: 'success', text: '詳細設定を保存しました。' };
    });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{guide.label}</h2>
          <p className="text-xs text-ink-300">{guide.vendor}</p>
        </div>
        <Badge className={status.className}>{status.label}</Badge>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-300">APIキー</dt>
          <dd className="font-mono text-ink-100">
            {provider?.hasApiKey ? (provider.apiKeyReadable === false ? <span className="font-sans text-rose-300">復号できません（再登録が必要）</span> : provider.apiKeyMasked) : <span className="font-sans text-ink-300">未登録</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-300">最終接続確認</dt>
          <dd className="text-ink-100">{provider?.connection.testedAt ? formatDate(provider.connection.testedAt, basic) : '—'}</dd>
        </div>
        {provider?.hasApiKey && (
          <>
            <div className="sm:col-span-2">
              <Field label="使用するモデル" hint={models.length ? `サービスから取得した ${models.length} 件のモデルから選べます` : '接続テストに成功すると、モデルの一覧を取得します'}>
                <select className={inputClass} value={provider.defaultModel ?? ''} disabled={busy !== null || modelOptions.length === 0} onChange={(e) => e.target.value && void changeModel(e.target.value)}>
                  {!provider.defaultModel && <option value="">選んでください</option>}
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName ? `${m.displayName}（${m.id}）` : m.id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-ink-100">
                <input type="checkbox" checked={provider.researchEnabled} disabled={busy !== null} onChange={(e) => void toggleResearch(e.target.checked)} />
                研究・実験で使う
              </label>
            </div>
          </>
        )}
      </dl>

      {provider?.connection.status === 'failed' && provider.connection.message && !result && (
        <div className="mt-3">
          <Alert kind="error" title="前回の接続テストで問題がありました">
            {provider.connection.message}
          </Alert>
        </div>
      )}

      {showKeyInput && (
        <div className="mt-4">
          <Field label={provider?.hasApiKey ? '新しい APIキー' : 'APIキー'} hint="貼り付けたキーはサーバーで暗号化して保存し、画面には再表示しません。">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} font-mono`}
              placeholder={guide.keyPlaceholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void connect()}
              disabled={!encryptionReady}
            />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" busy={busy === 'connect'} disabled={!encryptionReady || busy !== null} onClick={() => void connect()}>
              保存して接続テスト
            </Button>
            {editingKey && (
              <Button
                onClick={() => {
                  setEditingKey(false);
                  setApiKey('');
                }}
              >
                キャンセル
              </Button>
            )}
          </div>
        </div>
      )}

      {provider?.hasApiKey && !showKeyInput && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" busy={busy === 'test'} disabled={busy !== null} onClick={() => void test()}>
            接続テスト
          </Button>
          <Button disabled={busy !== null} onClick={() => setEditingKey(true)}>
            APIキーを変更
          </Button>
          <Button variant="danger" busy={busy === 'delete'} disabled={busy !== null} onClick={removeKey}>
            APIキーを削除
          </Button>
        </div>
      )}

      {msg && (
        <div className="mt-3">
          <Alert kind={msg.kind} title={msg.text} onClose={() => setMsg(null)} />
        </div>
      )}
      {result && <TestSteps result={result} />}

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-xs text-ink-200">APIキーの取得方法</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-100">
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-2 flex flex-wrap gap-3 text-xs">
          <a href={guide.keyUrl} target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-2">
            APIキーを発行する（公式ページ）
          </a>
          <a href={guide.modelsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            モデルの一覧（公式）
          </a>
        </p>
      </details>

      {provider && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-ink-200">詳細設定</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="タイムアウト（ミリ秒）" hint="1,000〜600,000。接続テストは最大 20 秒で打ち切ります">
              <input className={inputClass} value={adv.timeoutMs} onChange={(e) => setAdv({ ...adv, timeoutMs: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label="再試行の回数" hint="0〜10。一時的な障害（レート制限など）のときだけ間隔をあけて再試行します">
              <input className={inputClass} value={adv.maxRetries} onChange={(e) => setAdv({ ...adv, maxRetries: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label="同時に送るリクエスト数" hint="1〜64">
              <input className={inputClass} value={adv.maxConcurrency} onChange={(e) => setAdv({ ...adv, maxConcurrency: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label="月間の利用上限（USD）" hint="空欄は上限なし。上限に達すると実験を止めます（単価の登録が必要）">
              <input className={inputClass} value={adv.monthlyBudgetUsd} onChange={(e) => setAdv({ ...adv, monthlyBudgetUsd: e.target.value })} inputMode="decimal" />
            </Field>
            <div className="sm:col-span-2 space-y-1 text-xs text-ink-300">
              <p>接続先: {provider.baseUrl}（カスタムの接続先は「その他の接続先」から追加します）</p>
              <p>最大出力トークン数・推論の深さは、用途ごとに「モデル割り当て」で設定します。Temperature などのサンプリング設定は、研究の再現性のため送信していません（各サービスの既定値）。</p>
            </div>
          </div>
          <Button className="mt-3" busy={busy === 'advanced'} disabled={busy !== null} onClick={() => void saveAdvanced()}>
            詳細設定を保存
          </Button>
        </details>
      )}
    </Card>
  );
}
