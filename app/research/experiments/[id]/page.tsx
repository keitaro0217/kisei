'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import DecisionTable from '@/components/research/DecisionTable';
import { Alert, Badge, Button, Card, Loading, PageHeader, Stat, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, ApiError, formatDate, formatInt, formatUsd } from '@/lib/research/client';
import { errorCategoryLabels, experimentStatusLabels, providerTypeLabels } from '@/lib/research/labels';
import type { EpisodeResult, Experiment, RoleSnapshot } from '@/lib/research/types';

type Detail = { experiment: Experiment; episodes: EpisodeResult[]; episodeCount: number };

function RoleSnap({ label, r }: { label: string; r: RoleSnapshot | null }) {
  if (!r) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/40 p-3 text-xs">
      <p className="font-semibold text-white">{label}</p>
      <dl className="mt-1 space-y-0.5 text-ink-200">
        <div>プロバイダー: {r.providerName}（{providerTypeLabels[r.providerType]}）</div>
        <div className="truncate">接続先: {r.baseUrl}</div>
        <div>モデル: <span className="font-mono">{r.model}</span></div>
        <div>推論設定: {r.reasoning.effort ?? (r.reasoning.thinkingBudget !== undefined && r.reasoning.thinkingBudget !== null ? `思考予算 ${r.reasoning.thinkingBudget}` : 'モデル既定')}</div>
        <div>最大出力トークン: {r.maxOutputTokens}</div>
      </dl>
    </div>
  );
}

export default function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const onError = useCallback((e: unknown) => setError(e instanceof Error ? e.message : '読み込みに失敗しました'), []);
  const load = useCallback(() => api<Detail>(`/experiments/${id}?limit=200`).then(setData).catch(onError), [id, onError]);

  const status = data?.experiment.status;
  useEffect(() => {
    api<Detail>(`/experiments/${id}?limit=200`).then(setData).catch(onError);
    const active = status === 'running' || status === 'pausing' || status === 'stopping' || status === undefined;
    const t = setInterval(load, active ? 2000 : 15000);
    return () => clearInterval(t);
  }, [id, load, onError, status]);

  const act = async (action: 'pause' | 'resume' | 'stop') => {
    if (action === 'stop' && !window.confirm('実験を停止しますか？停止した実験は再開できません。')) return;
    setBusy(action);
    setActionError(null);
    try {
      await api(`/experiments/${id}/actions`, { method: 'POST', body: { action } });
      await load();
    } catch (e) {
      setActionError(`${e instanceof ApiError && e.label ? `${e.label}: ` : ''}${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Alert kind="error" title="読み込みに失敗しました">{error}</Alert>;
  if (!data) return <Loading />;
  const e = data.experiment;
  const done = e.completedEpisodes + e.failedEpisodes;
  const pct = Math.round((done / e.episodes) * 100);
  const completed = data.episodes.filter((x) => x.status === 'completed');
  const avg = (f: (x: EpisodeResult) => number | null) => {
    const vals = completed.map(f).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const s = e.snapshot;

  return (
    <div className="space-y-4">
      <Link href="/research/experiments" className="text-xs text-ink-200 hover:text-white">
        ← 研究実験
      </Link>
      <PageHeader
        title={e.name}
        description={e.description || `実験バージョン ${e.versionLabel}（${e.versionHash}）`}
        actions={
          <>
            {e.status === 'running' && (
              <Button onClick={() => act('pause')} busy={busy === 'pause'}>
                一時停止
              </Button>
            )}
            {e.status === 'paused' && (
              <Button variant="primary" onClick={() => act('resume')} busy={busy === 'resume'}>
                再開
              </Button>
            )}
            {(e.status === 'running' || e.status === 'paused') && (
              <Button variant="danger" onClick={() => act('stop')} busy={busy === 'stop'}>
                停止
              </Button>
            )}
          </>
        }
      />
      {actionError && <Alert kind="error" title="操作できませんでした" onClose={() => setActionError(null)}>{actionError}</Alert>}
      {e.statusReason && (
        <Alert kind={e.status === 'paused' && e.statusCategory ? 'warning' : 'info'} title={experimentStatusLabels[e.status].label}>
          {e.statusReason}
          {e.status === 'paused' && ' 研究条件（スナップショット）は保持されています。原因を解消してから再開してください。'}
        </Alert>
      )}

      <Card>
        <div className="flex items-center justify-between text-sm">
          <Badge className={experimentStatusLabels[e.status].className}>{experimentStatusLabels[e.status].label}</Badge>
          <span className="tabular-nums text-ink-200">
            {formatInt(done)} / {formatInt(e.episodes)} エピソード（{pct}%）
          </span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-ink-800">
          <div className="rc-primary h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="完了 / 失敗" value={`${formatInt(e.completedEpisodes)} / ${formatInt(e.failedEpisodes)}`} />
        <Stat label="平均損益（直近表示分）" value={avg((x) => x.pnl)?.toFixed(0) ?? '—'} sub={`平均規則違反 ${avg((x) => x.violationCount)?.toFixed(2) ?? '—'} 件`} />
        <Stat label="実験全体の費用（試算）" value={formatUsd(e.usage.costUsd)} sub={e.usage.unpricedCalls ? `料金未設定 ${formatInt(e.usage.unpricedCalls)} 件を除く` : `${formatInt(e.usage.calls)} 回呼び出し`} />
        <Stat label="エピソードあたりの費用" value={done ? formatUsd(e.usage.costUsd / done, 6) : '—'} sub={`入力 ${formatInt(e.usage.inputTokens)} / 出力 ${formatInt(e.usage.outputTokens)}`} />
      </div>

      <Card title="固定された研究条件（スナップショット）" description={`開始: ${formatDate(e.startedAt, basic)} ・ この実験は以降の設定変更の影響を受けません。`}>
        <div className="grid gap-3 md:grid-cols-2">
          <RoleSnap label="取引エージェント" r={s.roles.trading_agent} />
          <RoleSnap label="LLM Judge" r={s.roles.llm_judge} />
        </div>
        <dl className="mt-3 grid gap-1 text-xs text-ink-200 sm:grid-cols-2">
          <div>プロンプト: {s.prompts.promptVersion}</div>
          <div>ツール構成: {s.tools.toolVersion} / {s.tools.decisionFormat}</div>
          <div>市場: {s.market.steps}ステップ ・ 初期資金 {formatInt(s.market.initialCash)} ・ シード {e.seed}〜</div>
          <div>実行: 並列 {s.operational.episodeConcurrency} ・ 再試行 {s.operational.episodeRetries} ・ タイムアウト {s.operational.timeoutMs / 1000}秒</div>
        </dl>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-ink-200">規則文書を表示</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-ink-950/40 p-3 text-xs text-ink-50">{s.ruleDocument}</pre>
        </details>
      </Card>

      <Card title="エピソード" description={`直近 ${data.episodes.length} 件を表示（全 ${formatInt(data.episodeCount)} 件）`}>
        <Table head={['#', 'シード', '状態', '損益', '規則違反', 'Judge', '費用', '試行', '']} empty="まだエピソードがありません">
          {data.episodes.flatMap((ep) => {
            const rows = [
              <tr key={ep.index}>
                <td className={td}>{ep.index + 1}</td>
                <td className={td}>{ep.seed}</td>
                <td className={td}>
                  {ep.status === 'completed' ? (
                    <span className="text-emerald-300">完了</span>
                  ) : (
                    <span className="text-rose-300" title={ep.error?.message}>
                      失敗（{ep.error ? errorCategoryLabels[ep.error.category].split('（')[0] : ''}）
                    </span>
                  )}
                </td>
                <td className={td}>{formatInt(ep.pnl)}</td>
                <td className={td}>{ep.violationCount}</td>
                <td className={td}>{ep.judge ? (ep.judge.score ?? '—') : '—'}</td>
                <td className={td}>{formatUsd(ep.usage.costUsd, 6)}</td>
                <td className={td}>{ep.attempts}</td>
                <td className={td}>
                  {ep.decisions.length > 0 && (
                    <Button variant="ghost" onClick={() => setOpen(open === ep.index ? null : ep.index)}>
                      {open === ep.index ? '閉じる' : '詳細'}
                    </Button>
                  )}
                </td>
              </tr>,
            ];
            if (open === ep.index) {
              rows.push(
                <tr key={`${ep.index}-detail`}>
                  <td colSpan={9} className="bg-ink-950/40 p-3">
                    {ep.judge && <p className="mb-2 text-xs text-ink-100">Judge: {ep.judge.summary || ep.judge.parseError}</p>}
                    <DecisionTable decisions={ep.decisions} />
                  </td>
                </tr>,
              );
            }
            return rows;
          })}
        </Table>
      </Card>
    </div>
  );
}
