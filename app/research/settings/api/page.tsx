'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Field, inputClass, Loading, NoticeBar, PageHeader, type Notice } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, ApiError, formatDate } from '@/lib/research/client';
import { apiKeyRequired, connectionStatusLabels, defaultBaseUrls, errorCategoryLabels, providerTypeLabels } from '@/lib/research/labels';
import type { ConnectionTestResult, ProviderDTO, ProviderType } from '@/lib/research/types';

const TYPES = Object.keys(providerTypeLabels) as ProviderType[];
/** http:// を指定できる種別（サーバー側で許可リストのホストのみ接続を認める） */
const LOCAL_CAPABLE: ProviderType[] = ['ollama', 'openai_compatible'];

type FormState = {
  type: ProviderType;
  name: string;
  baseUrl: string;
  defaultModel: string;
  timeoutMs: string;
  maxRetries: string;
  maxConcurrency: string;
  monthlyBudgetUsd: string;
  apiKey: string;
};

const emptyForm = (type: ProviderType = 'openai'): FormState => ({
  type,
  name: providerTypeLabels[type],
  baseUrl: defaultBaseUrls[type],
  defaultModel: '',
  timeoutMs: '60000',
  maxRetries: '2',
  maxConcurrency: '4',
  monthlyBudgetUsd: '',
  apiKey: '',
});

/** 保存前の入力検証（サーバー側でも同じ検証を行う） */
function validate(form: FormState, isNew: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim() || form.name.trim().length > 60) errors.name = '表示名は1〜60文字で入力してください';
  const url = form.baseUrl.trim();
  if (!url) errors.baseUrl = 'Base URL を入力してください';
  else if (!/^https:\/\//i.test(url) && !(LOCAL_CAPABLE.includes(form.type) && /^http:\/\//i.test(url))) {
    errors.baseUrl = 'https:// で始まるURLを入力してください';
  }
  const intIn = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  if (!intIn(form.timeoutMs, 1000, 600000)) errors.timeoutMs = '1000〜600000（ミリ秒）で入力してください';
  if (!intIn(form.maxRetries, 0, 10)) errors.maxRetries = '0〜10で入力してください';
  if (!intIn(form.maxConcurrency, 1, 64)) errors.maxConcurrency = '1〜64で入力してください';
  if (form.monthlyBudgetUsd && !(Number(form.monthlyBudgetUsd) >= 0)) errors.monthlyBudgetUsd = '0以上の数値で入力してください';
  if (isNew && apiKeyRequired[form.type] && form.apiKey.trim().length > 0 && form.apiKey.trim().length < 8) errors.apiKey = 'APIキーが短すぎます';
  if (form.apiKey && /\s/.test(form.apiKey.trim())) errors.apiKey = 'APIキーに空白を含めることはできません';
  return errors;
}

function payload(form: FormState) {
  return {
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    defaultModel: form.defaultModel.trim() || null,
    timeoutMs: Number(form.timeoutMs),
    maxRetries: Number(form.maxRetries),
    maxConcurrency: Number(form.maxConcurrency),
    monthlyBudgetUsd: form.monthlyBudgetUsd === '' ? null : Number(form.monthlyBudgetUsd),
  };
}

function ProviderForm({
  initial,
  provider,
  onCancel,
  onSaved,
}: {
  initial: FormState;
  provider?: ProviderDTO;
  onCancel: () => void;
  onSaved: (p: ProviderDTO, message: string) => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isNew = !provider;
  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const errs = validate(form, isNew);
    setErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      let saved: ProviderDTO;
      if (isNew) {
        saved = (await api<{ provider: ProviderDTO }>('/providers', { method: 'POST', body: { type: form.type, ...payload(form) } })).provider;
        if (form.apiKey.trim()) {
          saved = (await api<{ provider: ProviderDTO }>(`/providers/${saved.id}/api-key`, { method: 'PUT', body: { apiKey: form.apiKey.trim() } })).provider;
        }
      } else {
        saved = (await api<{ provider: ProviderDTO }>(`/providers/${provider.id}`, { method: 'PATCH', body: payload(form) })).provider;
      }
      // 入力されたAPIキーはすぐにメモリから破棄する（ブラウザのストレージには保存しない）
      setForm((f) => ({ ...f, apiKey: '' }));
      onSaved(saved, isNew ? 'プロバイダーを登録しました。接続テストを実行してください。' : '設定を保存しました。');
    } catch (e) {
      if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
      setServerError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={isNew ? 'APIプロバイダーを追加' : `「${provider.name}」の設定を編集`}>
      <form
        className="space-y-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {serverError && <Alert kind="error" title="保存できませんでした">{serverError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="APIプロバイダー" required>
            <select
              className={inputClass}
              value={form.type}
              disabled={!isNew}
              onChange={(e) => {
                const type = e.target.value as ProviderType;
                setForm((f) => ({ ...emptyForm(type), apiKey: f.apiKey }));
              }}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {providerTypeLabels[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="表示名" required error={errors.name}>
            <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} />
          </Field>
          <Field
            label="Base URL"
            required
            error={errors.baseUrl}
            hint={LOCAL_CAPABLE.includes(form.type) ? 'http:// やローカルネットワークの接続先は、環境変数 LLM_ALLOWED_PRIVATE_HOSTS に登録したホストのみ利用できます' : '安全のため https:// のみ接続できます'}
          >
            <input className={inputClass} value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://..." />
          </Field>
          <Field label="既定のモデル" hint="保存後に「モデル一覧を取得」で選択できます（接続テストで使用）" error={errors.defaultModel}>
            {provider && provider.models.length > 0 ? (
              <select className={inputClass} value={form.defaultModel} onChange={(e) => set('defaultModel', e.target.value)}>
                <option value="">（選択してください）</option>
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName ? `${m.displayName}（${m.id}）` : m.id}
                  </option>
                ))}
              </select>
            ) : (
              <input className={inputClass} value={form.defaultModel} onChange={(e) => set('defaultModel', e.target.value)} placeholder="モデル一覧取得後に選択" />
            )}
          </Field>
          {isNew && (
            <Field
              label={apiKeyRequired[form.type] ? 'APIキー' : 'APIキー（任意）'}
              error={errors.apiKey}
              hint="サーバー側で AES-256-GCM により暗号化して保存します。登録後は全文を再表示しません。"
            >
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={form.apiKey}
                onChange={(e) => set('apiKey', e.target.value)}
                placeholder={apiKeyRequired[form.type] ? '後から登録することもできます' : '認証付きプロキシ経由の場合のみ'}
              />
            </Field>
          )}
          <Field label="タイムアウト（ミリ秒）" required error={errors.timeoutMs}>
            <input className={inputClass} inputMode="numeric" value={form.timeoutMs} onChange={(e) => set('timeoutMs', e.target.value)} />
          </Field>
          <Field label="再試行回数" required error={errors.maxRetries} hint="レート制限・通信障害・サーバー障害のときのみ再試行します">
            <input className={inputClass} inputMode="numeric" value={form.maxRetries} onChange={(e) => set('maxRetries', e.target.value)} />
          </Field>
          <Field label="同時実行数" required error={errors.maxConcurrency} hint="このプロバイダーへの同時リクエスト数の上限">
            <input className={inputClass} inputMode="numeric" value={form.maxConcurrency} onChange={(e) => set('maxConcurrency', e.target.value)} />
          </Field>
          <Field label="月間API予算（USD）" error={errors.monthlyBudgetUsd} hint="空欄は上限なし。上限到達時は実験を一時停止します">
            <input className={inputClass} inputMode="decimal" value={form.monthlyBudgetUsd} onChange={(e) => set('monthlyBudgetUsd', e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>キャンセル</Button>
          <Button variant="primary" type="submit" busy={busy}>
            {isNew ? '登録する' : '保存する'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ApiKeyEditor({ provider, onDone }: { provider: ProviderDTO; onDone: (p: ProviderDTO | null, notice: Notice) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const key = value.trim();
    if (key.length < 8 || /\s/.test(key)) {
      setError('空白を含まない8文字以上のAPIキーを入力してください');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ provider: ProviderDTO }>(`/providers/${provider.id}/api-key`, { method: 'PUT', body: { apiKey: key } });
      setValue('');
      onDone(res.provider, { kind: 'success', title: 'APIキーを保存しました', message: '暗号化して保存しました。接続テストで動作を確認してください。' });
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-ink-950/40 p-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          className={inputClass}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          aria-label="新しいAPIキー"
          placeholder={provider.hasApiKey ? '新しいAPIキーを入力（現在のキーを置き換えます）' : 'APIキーを入力'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="primary" type="submit" busy={busy}>
            保存
          </Button>
          <Button onClick={() => onDone(null, null)}>閉じる</Button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      <p className="mt-2 text-xs text-ink-200">APIキーはブラウザに保存されず、サーバーで暗号化して保管します。</p>
    </div>
  );
}

function TestResultView({ result }: { result: ConnectionTestResult }) {
  return (
    <div className={`mt-3 rounded-xl border p-3 ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
      <p className={`text-sm font-medium ${result.ok ? 'text-emerald-200' : 'text-rose-200'}`}>
        {result.ok ? '✓ 接続テストに成功しました' : `✕ ${result.errorCategory ? errorCategoryLabels[result.errorCategory] : '接続テストに失敗しました'}`}
        {result.model && <span className="ml-2 text-xs font-normal text-ink-200">モデル: {result.model}</span>}
      </p>
      <ol className="mt-2 space-y-1">
        {result.steps.map((s, i) => (
          <li key={s.key} className="flex gap-2 text-xs">
            <span className={s.status === 'ok' ? 'text-emerald-300' : s.status === 'failed' ? 'text-rose-300' : 'text-ink-300'}>
              {s.status === 'ok' ? '✓' : s.status === 'failed' ? '✕' : '–'}
            </span>
            <span className="text-ink-100">
              {i + 1}. {s.label}
              {s.message && <span className="text-ink-200">：{s.message}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProviderCard({ provider, onChange, onNotice }: { provider: ProviderDTO; onChange: (p: ProviderDTO | null) => void; onNotice: (n: Notice) => void }) {
  const basic = useBasicSettings() ?? undefined;
  const [mode, setMode] = useState<'view' | 'edit' | 'key'>('view');
  const [busy, setBusy] = useState<string | null>(null);
  const [testModel, setTestModel] = useState(provider.defaultModel ?? '');
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const status = connectionStatusLabels[provider.connection.status];

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      onNotice({ kind: 'error', title: e instanceof ApiError && e.label ? e.label : '操作に失敗しました', message: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const test = () =>
    run('test', async () => {
      const res = await api<{ result: ConnectionTestResult; provider: ProviderDTO | null }>(`/providers/${provider.id}/test`, {
        method: 'POST',
        body: { model: testModel || null },
      });
      setResult(res.result);
      if (res.provider) onChange(res.provider);
    });

  const fetchModels = () =>
    run('models', async () => {
      const res = await api<{ provider: ProviderDTO }>(`/providers/${provider.id}/models`, { method: 'POST' });
      onChange(res.provider);
      onNotice({ kind: 'success', title: `モデル一覧を取得しました（${res.provider.models.length} 件）` });
    });

  const removeKey = () => {
    if (!window.confirm(`「${provider.name}」のAPIキーを削除しますか？このプロバイダーを使う実験は実行できなくなります。`)) return;
    run('delkey', async () => {
      const res = await api<{ provider: ProviderDTO }>(`/providers/${provider.id}/api-key`, { method: 'DELETE' });
      onChange(res.provider);
      onNotice({ kind: 'success', title: 'APIキーを削除しました' });
    });
  };

  const remove = () => {
    if (!window.confirm(`プロバイダー「${provider.name}」を削除しますか？モデル割り当ても解除されます。`)) return;
    run('delete', async () => {
      await api(`/providers/${provider.id}`, { method: 'DELETE' });
      onChange(null);
      onNotice({ kind: 'success', title: 'プロバイダーを削除しました' });
    });
  };

  if (mode === 'edit') {
    return (
      <ProviderForm
        provider={provider}
        initial={{
          type: provider.type,
          name: provider.name,
          baseUrl: provider.baseUrl,
          defaultModel: provider.defaultModel ?? '',
          timeoutMs: String(provider.timeoutMs),
          maxRetries: String(provider.maxRetries),
          maxConcurrency: String(provider.maxConcurrency),
          monthlyBudgetUsd: provider.monthlyBudgetUsd === null ? '' : String(provider.monthlyBudgetUsd),
          apiKey: '',
        }}
        onCancel={() => setMode('view')}
        onSaved={(p, message) => {
          onChange(p);
          setMode('view');
          onNotice({ kind: 'success', title: message });
        }}
      />
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{provider.name}</h3>
            <Badge className={status.className}>{status.label}</Badge>
            <span className="text-xs text-ink-200">{providerTypeLabels[provider.type]}</span>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-2 min-w-0">
              <dt className="text-ink-200 flex-shrink-0">Base URL</dt>
              <dd className="truncate font-mono text-ink-100">{provider.baseUrl}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-200">APIキー</dt>
              <dd className="font-mono text-ink-100">
                {provider.hasApiKey ? provider.apiKeyMasked : apiKeyRequired[provider.type] ? <span className="text-rose-300">未登録</span> : '不要'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-200">既定モデル</dt>
              <dd className="text-ink-100">{provider.defaultModel ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-200">最終テスト</dt>
              <dd className="text-ink-100">{formatDate(provider.connection.testedAt, basic)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-200">タイムアウト / 再試行 / 同時実行</dt>
              <dd className="text-ink-100">
                {provider.timeoutMs / 1000}秒 / {provider.maxRetries}回 / {provider.maxConcurrency}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-200">月間予算</dt>
              <dd className="text-ink-100">{provider.monthlyBudgetUsd === null ? '上限なし' : `$${provider.monthlyBudgetUsd}`}</dd>
            </div>
          </dl>
          {provider.connection.status === 'failed' && provider.connection.message && !result && (
            <p className="mt-2 text-xs text-rose-300">{provider.connection.message}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button onClick={() => setMode(mode === 'key' ? 'view' : 'key')}>{provider.hasApiKey ? 'APIキーを更新' : 'APIキーを登録'}</Button>
          {provider.hasApiKey && (
            <Button variant="danger" onClick={removeKey} busy={busy === 'delkey'}>
              APIキーを削除
            </Button>
          )}
          <Button onClick={() => setMode('edit')}>編集</Button>
          <Button variant="ghost" onClick={remove} busy={busy === 'delete'}>
            削除
          </Button>
        </div>
      </div>

      {mode === 'key' && (
        <ApiKeyEditor
          provider={provider}
          onDone={(p, notice) => {
            if (p) {
              onChange(p);
              setResult(null);
            }
            if (notice) onNotice(notice);
            setMode('view');
          }}
        />
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
        <select className={`${inputClass} sm:max-w-xs`} value={testModel} onChange={(e) => setTestModel(e.target.value)} aria-label="テストするモデル">
          <option value="">{provider.defaultModel ? `既定モデル（${provider.defaultModel}）` : 'テストするモデルを選択'}</option>
          {provider.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName ? `${m.displayName}（${m.id}）` : m.id}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button onClick={fetchModels} busy={busy === 'models'} disabled={apiKeyRequired[provider.type] && !provider.hasApiKey}>
            使用可能モデルを取得
          </Button>
          <Button variant="primary" onClick={test} busy={busy === 'test'} disabled={apiKeyRequired[provider.type] && !provider.hasApiKey}>
            接続テスト
          </Button>
        </div>
        <span className="text-xs text-ink-200 sm:ml-auto">
          {provider.modelsFetchedAt ? `モデル ${provider.models.length} 件（${formatDate(provider.modelsFetchedAt, basic)} 取得）` : 'モデル未取得'}
        </span>
      </div>
      {result && <TestResultView result={result} />}
    </Card>
  );
}

export default function ApiIntegrationPage() {
  const [providers, setProviders] = useState<ProviderDTO[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState(true);

  useEffect(() => {
    api<{ providers: ProviderDTO[]; encryptionConfigured: boolean }>('/providers')
      .then((r) => {
        setProviders(r.providers);
        setEncryptionConfigured(r.encryptionConfigured);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : '読み込みに失敗しました'));
  }, []);

  const replace = (id: string, p: ProviderDTO | null) =>
    setProviders((list) => (list ?? []).flatMap((x) => (x.id === id ? (p ? [p] : []) : [x])));

  return (
    <div>
      <PageHeader
        title="API連携"
        description="AIモデルのAPI接続先と認証情報を管理します。APIキーはサーバーで暗号化して保存され、画面には再表示されません。"
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              ＋ プロバイダーを追加
            </Button>
          )
        }
      />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      {loadError && <Alert kind="error" title="読み込みに失敗しました">{loadError}</Alert>}
      {!encryptionConfigured && (
        <div className="mb-4">
          <Alert kind="warning" title="APIキーを登録するには準備が必要です">
            APIキーを暗号化して保存するための環境変数 <code>API_KEY_ENCRYPTION_KEY</code>（32バイトのランダムな値）が設定されていません。
            設定するまで、APIキーの登録と接続テストは利用できません（プロバイダーの追加と表示はできます）。
          </Alert>
        </div>
      )}
      <div className="space-y-4">
        {adding && (
          <ProviderForm
            initial={emptyForm()}
            onCancel={() => setAdding(false)}
            onSaved={(p, message) => {
              setProviders((list) => [...(list ?? []), p]);
              setAdding(false);
              setNotice({ kind: 'success', title: message });
            }}
          />
        )}
        {providers === null && !loadError ? (
          <Loading />
        ) : providers && providers.length === 0 && !adding ? (
          <EmptyState
            title="APIプロバイダーが未登録です"
            description="OpenAI・Anthropic・Gemini・OpenAI互換API・ローカルLLMから接続先を追加し、APIキーを登録して接続テストを行ってください。"
          />
        ) : (
          providers?.map((p) => <ProviderCard key={p.id} provider={p} onChange={(np) => replace(p.id, np)} onNotice={setNotice} />)
        )}
      </div>
    </div>
  );
}
