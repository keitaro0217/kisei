'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, NoticeBar, PageHeader, Stat, Table, td, type Notice } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate, formatInt, formatUsd } from '@/lib/research/client';
import { errorCategoryLabels, roleLabels } from '@/lib/research/labels';
import type { AppSettings, Experiment, ModelPrice, ProviderDTO, UsageRecord, UsageTotals } from '@/lib/research/types';

type UsageResponse = {
  month: string;
  months: string[];
  byProvider: Record<string, UsageTotals>;
  total: UsageTotals;
  budgets: { global: number | null; providers: Record<string, number | null> };
  history: UsageRecord[];
};

const purposeLabel = (r: UsageRecord['role']) =>
  r === 'connection_test' ? '接続テスト' : r === 'simulation' ? 'シミュレーション' : roleLabels[r]?.label ?? r;

const fetchAll = (month?: string) =>
  Promise.all([
    api<UsageResponse>(`/usage${month ? `?month=${month}` : ''}`),
    api<{ providers: ProviderDTO[] }>('/providers'),
    api<{ prices: ModelPrice[] }>('/pricing'),
    api<{ settings: AppSettings }>('/settings'),
    api<{ experiments: Experiment[] }>('/experiments'),
  ]);

const emptyPrice = { providerId: '', model: '', inputPerMTok: '', outputPerMTok: '', cachedInputPerMTok: '', cacheWritePerMTok: '', source: '' };

export default function CostsPage() {
  const basic = useBasicSettings() ?? undefined;
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [month, setMonth] = useState<string>('');
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [globalBudget, setGlobalBudget] = useState('');
  const [priceForm, setPriceForm] = useState(emptyPrice);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback(([u, p, pr, s, e]: Awaited<ReturnType<typeof fetchAll>>) => {
    setUsage(u);
    setMonth(u.month);
    setProviders(p.providers);
    setPrices(pr.prices);
    setGlobalBudget(s.settings.cost.globalMonthlyBudgetUsd === null ? '' : String(s.settings.cost.globalMonthlyBudgetUsd));
    setExperiments(e.experiments);
  }, []);
  const load = useCallback((m?: string) => fetchAll(m).then(apply), [apply]);

  useEffect(() => {
    fetchAll()
      .then(apply)
      .catch((e) => setNotice({ kind: 'error', title: '読み込みに失敗しました', message: e.message }));
  }, [apply]);

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? '（削除済み）';
  const fail = (title: string) => (e: unknown) => setNotice({ kind: 'error', title, message: e instanceof Error ? e.message : undefined });

  const saveGlobalBudget = async () => {
    if (globalBudget !== '' && !(Number(globalBudget) >= 0)) {
      setNotice({ kind: 'error', title: '予算は0以上の数値で入力してください' });
      return;
    }
    setBusy('budget');
    try {
      await api('/settings', { method: 'PUT', body: { cost: { globalMonthlyBudgetUsd: globalBudget === '' ? null : Number(globalBudget) } } });
      setNotice({ kind: 'success', title: '全体の月間予算を保存しました' });
      await load(month);
    } catch (e) {
      fail('保存できませんでした')(e);
    } finally {
      setBusy(null);
    }
  };

  const saveProviderBudget = async (p: ProviderDTO, value: string) => {
    if (value !== '' && !(Number(value) >= 0)) {
      setNotice({ kind: 'error', title: '予算は0以上の数値で入力してください' });
      return;
    }
    try {
      await api(`/providers/${p.id}`, { method: 'PATCH', body: { monthlyBudgetUsd: value === '' ? null : Number(value) } });
      setNotice({ kind: 'success', title: `「${p.name}」の月間予算を保存しました` });
      await load(month);
    } catch (e) {
      fail('保存できませんでした')(e);
    }
  };

  const savePrice = async () => {
    const errs: Record<string, string> = {};
    if (!priceForm.providerId) errs.providerId = 'プロバイダーを選択してください';
    if (!priceForm.model.trim()) errs.model = 'モデルを入力してください';
    for (const k of ['inputPerMTok', 'outputPerMTok'] as const) if (priceForm[k] === '' || !(Number(priceForm[k]) >= 0)) errs[k] = '0以上の数値を入力してください';
    for (const k of ['cachedInputPerMTok', 'cacheWritePerMTok'] as const) if (priceForm[k] !== '' && !(Number(priceForm[k]) >= 0)) errs[k] = '0以上の数値を入力してください';
    if (!priceForm.source.trim()) errs.source = '出典（料金表のURL・確認日など）を入力してください';
    setPriceErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy('price');
    try {
      await api('/pricing', { method: 'PUT', body: priceForm });
      setPriceForm(emptyPrice);
      setNotice({ kind: 'success', title: '単価を保存しました', message: '以降のAPI呼び出しの費用計算に使用されます。' });
      await load(month);
    } catch (e) {
      fail('保存できませんでした')(e);
    } finally {
      setBusy(null);
    }
  };

  const deletePrice = async (p: ModelPrice) => {
    if (!window.confirm(`${p.model} の単価を削除しますか？`)) return;
    try {
      await api(`/pricing?providerId=${encodeURIComponent(p.providerId)}&model=${encodeURIComponent(p.model)}`, { method: 'DELETE' });
      await load(month);
    } catch (e) {
      fail('削除できませんでした')(e);
    }
  };

  if (!usage) return <Loading />;
  const total = usage.total;
  const remaining = usage.budgets.global === null ? null : Math.max(0, usage.budgets.global - total.costUsd);
  const selectedProvider = providers.find((p) => p.id === priceForm.providerId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="費用管理"
        description="API使用量と、管理者が登録した単価に基づく費用を記録します。"
        actions={
          <select className={`${inputClass} w-36`} value={month} onChange={(e) => load(e.target.value)} aria-label="対象月">
            {[usage.month, ...usage.months.filter((m) => m !== usage.month)].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        }
      />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      <Alert kind="info" title="料金の扱い">
        各プロバイダーは料金表をAPIで提供していないため、費用は管理者が出典つきで登録した単価のみで計算します。単価が未登録のモデルの呼び出しは「料金未設定」として件数のみ表示し、推測値は表示しません。
        予算上限に達した場合、実験は研究条件を保持したまま一時停止します（モデルの自動変更や実験回数の削減は行いません）。
      </Alert>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="月間使用額（試算）" value={formatUsd(total.costUsd)} sub={total.unpricedCalls > 0 ? `料金未設定の呼び出し ${formatInt(total.unpricedCalls)} 件を除く` : '登録単価に基づく'} />
        <Stat label="予算残額" value={remaining === null ? '上限なし' : formatUsd(remaining)} sub={usage.budgets.global === null ? '全体予算は未設定' : `全体予算 ${formatUsd(usage.budgets.global, 2)}`} />
        <Stat label="API呼び出し回数" value={formatInt(total.calls)} />
        <Stat label="入力 / 出力トークン" value={`${formatInt(total.inputTokens)} / ${formatInt(total.outputTokens)}`} />
        <Stat label="キャッシュ済みトークン" value={formatInt(total.cachedTokens)} sub={`キャッシュ書き込み ${formatInt(total.cacheWriteTokens)}`} />
        <Stat label="推論トークン" value={formatInt(total.reasoningTokens)} sub="取得可能なプロバイダーのみ" />
      </div>

      <Card title="予算上限" description="上限に達すると新しいAPI呼び出しを止め、実験を一時停止します。">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="全体の月間予算（USD）" hint="空欄は上限なし">
            <input className={`${inputClass} sm:w-48`} inputMode="decimal" value={globalBudget} onChange={(e) => setGlobalBudget(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={saveGlobalBudget} busy={busy === 'budget'}>
            保存
          </Button>
        </div>
        <div className="mt-4">
          <Table head={['プロバイダー', '呼び出し', '入力', '出力', 'キャッシュ', '推論', '使用額', '料金未設定', '月間予算（USD）']} empty="プロバイダーが登録されていません">
            {providers.map((p) => {
              const t = usage.byProvider[p.id];
              return (
                <tr key={p.id}>
                  <td className={td}>{p.name}</td>
                  <td className={td}>{formatInt(t?.calls ?? 0)}</td>
                  <td className={td}>{formatInt(t?.inputTokens ?? 0)}</td>
                  <td className={td}>{formatInt(t?.outputTokens ?? 0)}</td>
                  <td className={td}>{formatInt(t?.cachedTokens ?? 0)}</td>
                  <td className={td}>{formatInt(t?.reasoningTokens ?? 0)}</td>
                  <td className={td}>{formatUsd(t?.costUsd ?? 0)}</td>
                  <td className={td}>{formatInt(t?.unpricedCalls ?? 0)}</td>
                  <td className={td}>
                    <input
                      className={`${inputClass} w-28`}
                      defaultValue={p.monthlyBudgetUsd ?? ''}
                      placeholder="上限なし"
                      aria-label={`${p.name}の月間予算`}
                      onBlur={(e) => {
                        if (e.target.value !== String(p.monthlyBudgetUsd ?? '')) saveProviderBudget(p, e.target.value);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      </Card>

      <Card title="料金設定" description="モデルごとの単価（USD / 100万トークン）。料金表の最新値を確認し、出典とともに登録してください。">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="プロバイダー" required error={priceErrors.providerId}>
            <select className={inputClass} value={priceForm.providerId} onChange={(e) => setPriceForm({ ...priceForm, providerId: e.target.value, model: '' })}>
              <option value="">（選択）</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="モデル" required error={priceErrors.model}>
            <input className={inputClass} list="price-models" value={priceForm.model} onChange={(e) => setPriceForm({ ...priceForm, model: e.target.value })} />
            <datalist id="price-models">
              {selectedProvider?.models.map((m) => <option key={m.id} value={m.id} />)}
            </datalist>
          </Field>
          <Field label="入力単価" required error={priceErrors.inputPerMTok}>
            <input className={inputClass} inputMode="decimal" value={priceForm.inputPerMTok} onChange={(e) => setPriceForm({ ...priceForm, inputPerMTok: e.target.value })} />
          </Field>
          <Field label="出力単価" required error={priceErrors.outputPerMTok} hint="推論トークンを含む">
            <input className={inputClass} inputMode="decimal" value={priceForm.outputPerMTok} onChange={(e) => setPriceForm({ ...priceForm, outputPerMTok: e.target.value })} />
          </Field>
          <Field label="キャッシュ読み取り単価" error={priceErrors.cachedInputPerMTok} hint="空欄は入力単価と同額">
            <input className={inputClass} inputMode="decimal" value={priceForm.cachedInputPerMTok} onChange={(e) => setPriceForm({ ...priceForm, cachedInputPerMTok: e.target.value })} />
          </Field>
          <Field label="キャッシュ書き込み単価" error={priceErrors.cacheWritePerMTok} hint="空欄は入力単価と同額">
            <input className={inputClass} inputMode="decimal" value={priceForm.cacheWritePerMTok} onChange={(e) => setPriceForm({ ...priceForm, cacheWritePerMTok: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="出典" required error={priceErrors.source} hint="例: 公式料金ページのURLと確認日">
              <input className={inputClass} value={priceForm.source} onChange={(e) => setPriceForm({ ...priceForm, source: e.target.value })} />
            </Field>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={savePrice} busy={busy === 'price'}>
            単価を保存
          </Button>
        </div>
        <div className="mt-4">
          <Table head={['プロバイダー', 'モデル', '入力', '出力', 'キャッシュ読取', 'キャッシュ書込', '出典', '更新', '']} empty="単価が登録されていません（費用は「料金未設定」として扱われます）">
            {prices.map((p) => (
              <tr key={`${p.providerId}/${p.model}`}>
                <td className={td}>{providerName(p.providerId)}</td>
                <td className={`${td} font-mono text-xs`}>{p.model}</td>
                <td className={td}>${p.inputPerMTok}</td>
                <td className={td}>${p.outputPerMTok}</td>
                <td className={td}>{p.cachedInputPerMTok === null ? '—' : `$${p.cachedInputPerMTok}`}</td>
                <td className={td}>{p.cacheWritePerMTok === null ? '—' : `$${p.cacheWritePerMTok}`}</td>
                <td className={`${td} max-w-xs truncate`} title={p.source}>
                  {p.source}
                </td>
                <td className={td}>{formatDate(p.updatedAt, basic)}</td>
                <td className={td}>
                  <Button variant="ghost" onClick={() => deletePrice(p)}>
                    削除
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>

      <Card title="実験ごとの費用">
        <Table head={['実験', 'バージョン', 'エピソード', '呼び出し', '実験全体の費用', 'エピソードあたり', '料金未設定']} empty="実験はまだありません">
          {experiments.map((e) => {
            const n = e.completedEpisodes + e.failedEpisodes;
            return (
              <tr key={e.id}>
                <td className={td}>
                  <Link href={`/research/experiments/${e.id}`} className="hover:text-white">
                    {e.name}
                  </Link>
                </td>
                <td className={td}>{e.versionLabel}</td>
                <td className={td}>
                  {n} / {e.episodes}
                </td>
                <td className={td}>{formatInt(e.usage.calls)}</td>
                <td className={td}>{formatUsd(e.usage.costUsd)}</td>
                <td className={td}>{n > 0 ? formatUsd(e.usage.costUsd / n, 6) : '—'}</td>
                <td className={td}>{formatInt(e.usage.unpricedCalls)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="使用履歴" description="直近200件のAPI呼び出し（失敗した呼び出しを含む）">
        <div className="max-h-[28rem] overflow-y-auto">
          <Table head={['日時', 'プロバイダー', 'モデル', '用途', '入力', '出力', 'キャッシュ', '推論', '費用', '結果']}>
            {usage.history.map((r) => (
              <tr key={r.id}>
                <td className={td}>{formatDate(r.at, basic)}</td>
                <td className={td}>{providerName(r.providerId)}</td>
                <td className={`${td} font-mono text-xs`}>{r.model}</td>
                <td className={td}>{purposeLabel(r.role)}</td>
                <td className={td}>{formatInt(r.usage.inputTokens)}</td>
                <td className={td}>{formatInt(r.usage.outputTokens)}</td>
                <td className={td}>{formatInt(r.usage.cachedTokens)}</td>
                <td className={td}>{r.usage.reasoningTokens === null ? '—' : formatInt(r.usage.reasoningTokens)}</td>
                <td className={td}>{!r.ok ? '—' : r.costUsd === null ? <span className="text-amber-300">料金未設定</span> : formatUsd(r.costUsd, 6)}</td>
                <td className={td}>{r.ok ? <span className="text-emerald-300">成功</span> : <span className="text-rose-300">{r.errorCategory ? errorCategoryLabels[r.errorCategory].split('（')[0] : '失敗'}</span>}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </div>
  );
}
