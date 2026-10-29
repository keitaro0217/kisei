'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import DecisionLog, { type DecisionFocus } from '@/components/research/DecisionLog';
import StudyChart from '@/components/research/StudyChart';
import { Alert, Badge, Button, Card, Loading, PageHeader, Stat, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import { objectiveLabels, personaLabels, studyStatusLabels } from '@/lib/research/study-labels';
import type { Study, StudySession } from '@/lib/research/study-types';
import type { StudyStats } from '@/lib/server/research/study/stats';
import type { LogisticResult } from '@/lib/server/research/study/regression';
import { ForestPlot, StepSeries } from '@/components/research/ComparisonCharts';

type Detail = { study: Study; sessions: StudySession[]; stats: StudyStats | null; regression: LogisticResult | null };

const pct = (p: number | null) => (p === null ? '—' : `${(p * 100).toFixed(1)}%`);
const ci = (c: [number, number] | null) => (c ? `[${(c[0] * 100).toFixed(1)}, ${(c[1] * 100).toFixed(1)}]` : '');
const pval = (p: number | null) => (p === null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
const num = (x: number | null, d = 2) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(d));

const EXPORTS: [string, string][] = [
  ['report.md', 'レポート（Markdown）'],
  ['decisions.csv', '意思決定ログ（CSV）'],
  ['sessions.csv', 'セッション（CSV）'],
  ['summary.json', '集計結果（JSON）'],
  ['config.json', '凍結設定（JSON）'],
  ['manifest.json', '再現性マニフェスト（JSON）'],
];

export default function StudyPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  // トレースから「?condition=&replicate=&step=」で開いた場合に表示する判断
  const focus = useMemo<DecisionFocus | null>(() => {
    const c = search.get('condition');
    const r = search.get('replicate');
    const st = search.get('step');
    if (!c || !r || !/^\d+$/.test(r)) return null;
    return { conditionId: c, replicate: Number(r), step: st && /^\d+$/.test(st) ? Number(st) : null };
  }, [search]);
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Detail>(`/studies/${id}`)
        .then(setData)
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;
  const { study, sessions, stats, regression } = data;
  const d = study.frozen?.design ?? study.design;
  const done = sessions.filter((s) => s.status === 'completed').length;
  const failed = sessions.filter((s) => s.status === 'failed').length;
  const label = (cid: string) => d.conditions.find((c) => c.id === cid)?.label ?? cid;

  const act = async (action: string) => {
    if (action === 'start' && study.design.agent.kind === 'model') {
      const calls = d.conditions.length * d.replicates * d.market.steps;
      if (!window.confirm(`AIモデルを約 ${calls.toLocaleString()} 回呼び出します（費用が発生します）。開始しますか？`)) return;
    }
    if (action === 'stop' && !window.confirm('研究を停止すると、未実行のセッションは実行されません。停止しますか？')) return;
    setBusy(action);
    setError(null);
    try {
      await api(`/studies/${id}/actions`, { method: 'POST', body: { action } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const status = studyStatusLabels[study.status];

  return (
    <>
      <PageHeader
        title={d.title}
        description={d.question || undefined}
        actions={
          <>
            {study.frozen && (
              <>
                <Link href={`/research/studies/${id}/evaluation`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
                  多層評価
                </Link>
                <Link href={`/research/traces?study=${id}`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
                  実行トレース
                </Link>
              </>
            )}
            {study.status === 'draft' && (
              <Button variant="primary" busy={busy === 'start'} onClick={() => act('start')}>
                設定を凍結して開始
              </Button>
            )}
            {study.status === 'running' && (
              <Button busy={busy === 'pause'} onClick={() => act('pause')}>
                一時停止
              </Button>
            )}
            {study.status === 'paused' && (
              <Button variant="primary" busy={busy === 'resume'} onClick={() => act('resume')}>
                再開
              </Button>
            )}
            {(study.status === 'running' || study.status === 'paused') && (
              <Button variant="danger" busy={busy === 'stop'} onClick={() => act('stop')}>
                停止
              </Button>
            )}
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {study.isMock && (
        <div className="mb-4">
          <Alert kind="warning" title="モックデータ">
            この研究は決定論的なモックエージェントで実行されます。行動は条文を読まずにシードから生成されるため、条件間の差は規則エンジンの判定の違いだけを反映します。AIの行動に関する研究結果として解釈・引用しないでください。
          </Alert>
        </div>
      )}
      {study.statusReason && (
        <div className="mb-4">
          <Alert kind={study.status === 'completed' ? 'info' : 'warning'} title="状態の詳細">
            {study.statusReason}
          </Alert>
        </div>
      )}

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="状態" value={<Badge className={status.className}>{status.label}</Badge>} sub={study.startedAt ? `開始 ${formatDate(study.startedAt, basic)}` : '未開始'} />
          <Stat label="セッションの進捗" value={`${done} / ${sessions.length || d.conditions.length * d.replicates}`} sub={failed ? `失敗 ${failed} 件（結果から除外）` : '条件 × 反復'} />
          <Stat label="判断の記録数" value={(stats?.conditions.reduce((a, c) => a + c.decisions, 0) ?? 0).toLocaleString()} sub={`${d.market.steps} ステップ / セッション`} />
          <Stat label="エージェント" value={study.isMock ? 'モック' : (study.frozen?.agentRole?.model ?? 'AIモデル')} sub={study.frozen?.agentRole?.providerName ?? (study.isMock ? 'APIキー不要' : '開始時に固定')} />
        </div>
        {sessions.length > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-label="進捗">
            <div className="h-full bg-white transition-all" style={{ width: `${(done / sessions.length) * 100}%` }} />
          </div>
        )}

        <Card title="研究デザイン" description={study.frozen ? '開始時に凍結した内容です。変更できません。' : '下書きです。開始すると凍結されます。'}>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            {[
              ['帰無仮説', d.nullHypothesis],
              ['対立仮説', d.alternativeHypothesis],
              ['独立変数', d.independentVariables],
              ['従属変数', d.dependentVariables],
              ['統制変数', d.controlVariables],
              ['分析計画', d.analysisPlan],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-300">{k}</dt>
                <dd className="text-ink-100">{v || '—'}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-ink-300">市場</dt>
              <dd className="text-ink-100">
                外生価格＋単純約定・{d.market.steps}ステップ・初期価格 {d.market.initialPrice}・ボラティリティ {d.market.volatility}・反復 {d.replicates} 回・基準シード {d.baseSeed}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-300">凍結設定のハッシュ（SHA-256）</dt>
              <dd className="break-all font-mono text-xs text-ink-100">{study.frozenHash ?? '未凍結'}</dd>
              {study.frozen && <dd className="text-xs text-ink-300">コードのバージョン: {study.frozen.codeVersion}</dd>}
            </div>
          </dl>
          <div className="mt-4">
            <Table head={['条件', '規則', '条文', '趣旨', '目標', 'ペルソナ']}>
              {d.conditions.map((c) => (
                <tr key={c.id}>
                  <td className={td}>
                    <span className="font-mono text-xs text-ink-300">{c.id}</span> {c.label}
                  </td>
                  <td className={`${td} text-xs`}>
                    {c.ruleVersionIds
                      .map((rid) => study.frozen?.rules.find((r) => r.id === rid))
                      .map((r) => (r ? `${r.ruleKey} v${r.version}` : null))
                      .filter(Boolean)
                      .join(', ') || (study.frozen ? 'なし' : `${c.ruleVersionIds.length} 件`)}
                  </td>
                  <td className={td}>{c.presentRules ? '提示' : '提示しない'}</td>
                  <td className={td}>{c.includePurpose ? '提示' : '—'}</td>
                  <td className={td}>{objectiveLabels[c.objective]}</td>
                  <td className={td}>{personaLabels[c.persona]}</td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>

        {stats && (
          <>
            <Card title="結果" description="完了したセッションのみを集計しています。">
              <Table head={['条件', '完了/失敗/未実行', '判断数', '試行数', '規則違反率 [95% CI]', '拒否率', '趣旨逸脱率（受理中）', '判定不能率', '説明と判定の不一致（拒否中）', '損益の平均（SD）', '損益の中央値 [最小, 最大]', '費用 (USD)', 'セッション時間（平均）']}>
                {stats.conditions.map((s) => (
                  <tr key={s.conditionId}>
                    <td className={td}>{s.label}</td>
                    <td className={td}>
                      {s.sessions.completed}/{s.sessions.failed}/{s.sessions.pending + s.sessions.running}
                    </td>
                    <td className={td}>{s.decisions}</td>
                    <td className={td}>{s.orderAttempts}</td>
                    <td className={td}>
                      {pct(s.ruleViolationRate.p)} <span className="text-xs text-ink-300">{ci(s.ruleViolationRate.ci)}</span>
                    </td>
                    <td className={td}>{pct(s.engineRejectRate.p)}</td>
                    <td className={td}>{pct(s.intentDeviationRate.p)}</td>
                    <td className={td}>{pct(s.undecidableRate.p)}</td>
                    <td className={td}>{pct(s.discrepancyRate.p)}</td>
                    <td className={td}>
                      {num(s.pnl.mean, 0)} <span className="text-xs text-ink-300">({num(s.pnl.sd, 0)})</span>
                    </td>
                    <td className={td}>
                      {num(s.pnl.median, 0)} <span className="text-xs text-ink-300">[{num(s.pnl.min, 0)}, {num(s.pnl.max, 0)}]</span>
                    </td>
                    <td className={td}>{s.costUsd > 0 ? `$${s.costUsd.toFixed(4)}` : study.isMock ? '0（モック）' : '—'}</td>
                    <td className={td}>{num(s.sessionSeconds.mean, 2)} 秒</td>
                  </tr>
                ))}
              </Table>
            </Card>

            <Card title="条件別の比率">
              <StudyChart
                title="条件別の規則違反率・拒否率・趣旨逸脱率"
                isMock={study.isMock}
                metrics={['規則違反率', '拒否率', '趣旨逸脱率']}
                series={stats.conditions.map((s) => ({ id: s.conditionId, label: s.label, values: [s.ruleViolationRate, s.engineRejectRate, s.intentDeviationRate] }))}
              />
            </Card>

            {stats.comparisons.length > 0 && (
              <Card title="条件間の比較（規則違反率）" description="主要な推測は、反復を単位とする対応のあるブートストラップ区間と符号反転の並べ替え検定です。χ² と Fisher は判断を独立と仮定した参考値です。">
                <Table head={['比較', '差', 'ブートストラップ 95% CI', '対応のある反復', '並べ替え検定 p', 'Holm 補正 p', 'Cohen h', 'オッズ比', 'χ² p（参考）', 'Fisher p（参考）']}>
                  {stats.comparisons.map((c) => (
                    <tr key={`${c.treatment}-${c.control}`}>
                      <td className={td}>
                        {c.primary && <Badge className="mr-1 bg-white/10 text-white ring-white/30">主要</Badge>}
                        {label(c.treatment)} − {label(c.control)}
                      </td>
                      <td className={td}>{c.pooledDiff === null ? '—' : `${(c.pooledDiff * 100).toFixed(1)} pt`}</td>
                      <td className={td}>{c.bootstrapCi ? `${ci(c.bootstrapCi)} pt` : '—'}</td>
                      <td className={td}>{c.pairedReplicates}</td>
                      <td className={td}>
                        {pval(c.permutationP)}
                        {!c.permutationExact && <span className="text-xs text-ink-300">（近似）</span>}
                      </td>
                      <td className={td}>{pval(c.holmP)}</td>
                      <td className={td}>{num(c.cohensH, 3)}</td>
                      <td className={td}>{num(c.oddsRatio)}</td>
                      <td className={td}>{pval(c.chiSquare?.p ?? null)}</td>
                      <td className={td}>{pval(c.fisherP)}</td>
                    </tr>
                  ))}
                </Table>
                <div className="mt-5">
                  <ForestPlot
                    isMock={study.isMock}
                    rows={stats.comparisons.map((c) => ({ label: `${label(c.treatment)} − ${label(c.control)}`, estimate: c.pooledDiff, ci: c.bootstrapCi, primary: c.primary, p: c.holmP }))}
                  />
                </div>
              </Card>
            )}

            <Card title="ステップごとの規則違反率">
              <StepSeries isMock={study.isMock} series={stats.conditions.map((c) => ({ label: c.label, values: c.stepViolationRate }))} />
            </Card>

            {regression && (
              <Card
                title="要因の効果（ロジスティック回帰）"
                description="目的変数は発注・取消の試行が規則違反を含むかどうか。条件間で値が2通りに分かれる要因を説明変数とし、すべての組み合わせがある2要因には交互作用を加えます。"
              >
                {!regression.ok ? (
                  <Alert kind="info" title="推定できません">
                    {regression.reason}
                  </Alert>
                ) : (
                  <>
                    <p className="mb-3 text-xs text-ink-200">
                      試行 {regression.n} 件（違反 {regression.events} 件）・セッション {regression.clusters} 個・基準: {regression.baseline}
                    </p>
                    <Table head={['項', '係数（対数オッズ）', 'クラスター頑健 SE', 'オッズ比', '95% 区間', 'p 値']}>
                      {regression.coefficients.map((c) => (
                        <tr key={c.term}>
                          <td className={td}>{c.label}</td>
                          <td className={td}>{c.estimate.toFixed(3)}</td>
                          <td className={td}>{c.se.toFixed(3)}</td>
                          <td className={td}>{c.oddsRatio.toFixed(3)}</td>
                          <td className={td}>
                            [{c.ci[0].toFixed(3)}, {c.ci[1].toFixed(3)}]
                          </td>
                          <td className={td}>{pval(c.p)}</td>
                        </tr>
                      ))}
                    </Table>
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-200">
                      {regression.levels.map((l) => (
                        <li key={l.factor}>
                          {l.label}: 基準 = {l.baseline.length > 40 ? '対照群の値' : l.baseline}、処置 = {l.treatment.length > 40 ? '他方の値' : l.treatment}
                        </li>
                      ))}
                      {regression.skippedFactors.map((f) => (
                        <li key={f.factor}>
                          {f.label}: {f.reason}
                        </li>
                      ))}
                      {regression.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
            )}

            <Card title="注意事項">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-100">
                {stats.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>監視AI（Monitor Evidence）の評価は、このバージョンでは未実装です。Judge と人による評価は「多層評価」の画面で行います。</li>
                <li>本結果は閉じた合成市場における研究用の実験結果であり、法令の解釈・適法性の判断ではありません。</li>
              </ul>
            </Card>

            <Card title="エクスポート" description={study.isMock ? 'ファイル名と内容に「MOCK」「モックデータ」の表示が付きます。' : undefined}>
              <div className="flex flex-wrap gap-2">
                {EXPORTS.map(([f, l]) => (
                  <a key={f} href={`/api/research/studies/${id}/export?format=${f}`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10 hover:text-white">
                    {l}
                  </a>
                ))}
              </div>
            </Card>

            <DecisionLog studyId={id} conditions={d.conditions.map((c) => ({ id: c.id, label: c.label }))} focus={focus} />
          </>
        )}
        <p className="text-xs text-ink-300">
          <Link href="/research/studies" className="underline underline-offset-2">
            研究プロジェクトの一覧へ戻る
          </Link>
        </p>
      </div>
    </>
  );
}
