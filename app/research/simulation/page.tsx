'use client';

import { useEffect, useState } from 'react';
import DecisionTable from '@/components/research/DecisionTable';
import MarketFields, { defaultMarketForm, marketPayload, validateMarket, type MarketForm } from '@/components/research/MarketFields';
import SetupGuide from '@/components/research/SetupGuide';
import { Alert, Button, Card, PageHeader, Stat } from '@/components/research/ui';
import { api, ApiError, formatInt, formatUsd } from '@/lib/research/client';
import type { EpisodeResult, ProviderDTO, ResearchRole, RoleAssignment } from '@/lib/research/types';

type SimResult = { result: Omit<EpisodeResult, 'status' | 'error' | 'attempts'>; ruleDocument: string; model: string };

export default function SimulationPage() {
  const [form, setForm] = useState<MarketForm>(defaultMarketForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [data, setData] = useState<SimResult | null>(null);
  const [setup, setSetup] = useState<{ providers: ProviderDTO[]; roles: Record<ResearchRole, RoleAssignment> } | null>(null);

  useEffect(() => {
    api<{ providers: ProviderDTO[]; roles: Record<ResearchRole, RoleAssignment> }>('/overview').then(setSetup).catch(() => undefined);
  }, []);

  const run = async () => {
    const invalid = validateMarket(form);
    if (invalid) {
      setError({ title: '入力値を確認してください', message: invalid });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setData(await api<SimResult>('/simulation', { method: 'POST', body: marketPayload(form) }));
    } catch (e) {
      setError({ title: e instanceof ApiError && e.label ? e.label : '実行できませんでした', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const r = data?.result;
  return (
    <div className="space-y-4">
      <PageHeader title="シミュレーション" description="現在のモデル割り当てで、仮想市場の1エピソードを試行します。実験としては記録されませんが、API使用量は記録されます。" />
      {setup && <SetupGuide providers={setup.providers} roles={setup.roles} compact />}
      <Card title="市場条件">
        <MarketFields form={form} onChange={setForm} />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={run} busy={busy}>
            {busy ? '実行中…' : '1エピソードを実行'}
          </Button>
        </div>
      </Card>
      {error && <Alert kind="error" title={error.title}>{error.message}</Alert>}
      {r && data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="最終資産評価額" value={formatInt(r.finalValue)} sub={`モデル: ${data.model}`} />
            <Stat label="損益" value={<span className={(r.pnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{formatInt(r.pnl)}</span>} />
            <Stat label="規則違反" value={r.violationCount} />
            <Stat label="費用（試算）" value={formatUsd(r.usage.costUsd, 6)} sub={`${r.usage.calls} 回呼び出し${r.usage.unpricedCalls ? ` ・ 料金未設定 ${r.usage.unpricedCalls}` : ''}`} />
          </div>
          {r.judge && (
            <Card title="LLM Judge の評価">
              <p className="text-sm text-white">スコア: {r.judge.score ?? '—'} / 5</p>
              <p className="mt-1 text-sm text-ink-200">{r.judge.summary || r.judge.parseError}</p>
              {r.judge.issues.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-ink-200">
                  {r.judge.issues.map((i, n) => (
                    <li key={n}>{i}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card title="取引ログ">
            <DecisionTable decisions={r.decisions} />
          </Card>
          <Card title="適用した規則文書">
            <pre className="whitespace-pre-wrap text-xs text-ink-100">{data.ruleDocument}</pre>
          </Card>
        </>
      )}
    </div>
  );
}
