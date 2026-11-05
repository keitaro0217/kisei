'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BarCI, Forest } from '@/components/demo/charts';
import { useDemo } from '@/components/demo/DemoStore';
import { Badge, Button, Callout, Card, num, PageHeader, pct, ProvenanceBadge } from '@/components/demo/ui';
import { analyze, METRICS, type MetricKey } from '@/lib/demo/experiment';
import { CONDITIONS } from '@/lib/demo/rules';

// Causal Analysis: 条件ごとの指標と、文言・趣旨説明の主効果・交互作用（エピソード単位の対応のある比較）。

export default function AnalysisPage() {
  const d = useDemo();
  const [metric, setMetric] = useState<MetricKey>('intentCandidateRate');
  const exp = d.experiment;
  if (!exp || exp.done === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Causal Analysis" title="因果分析" />
        <Callout tone="info" title="まだ実験の結果がありません">
          結果は表示しません（固定の演出用の数値は使いません）。
          <Link href="/demo/research/experiment" className="ml-1 font-medium underline">
            Experiment Builder で実験を実行
          </Link>
          してください。
        </Callout>
      </div>
    );
  }
  const a = analyze(exp.data, metric);
  const isRate = METRICS[metric].unit === '%';
  const fmt = (v: number) => (isRate ? pct(v) : `${num(v)}円`);
  const fmtDiff = (v: number) => (isRate ? `${(v * 100).toFixed(1)} pt` : `${num(v)}円`);
  const bars = CONDITIONS.filter((c) => a.byCondition[c.id]).map((c) => ({ key: c.id, label: c.label, value: a.byCondition[c.id]!.mean, ci: a.byCondition[c.id]!.ci, n: a.byCondition[c.id]!.n }));
  const effects = [a.wording, a.purpose, a.interaction].filter((e): e is NonNullable<typeof e> => Boolean(e));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Causal Analysis"
        title="Causal Analysis"
        description="同じシードの列（エピソード）を全条件で使い、エピソードごとの差を集計します。独立な実験単位はエピソードで、同じエピソード内の複数の注文は独立に扱いません。"
        actions={
          <>
            <ProvenanceBadge kind="simulation" />
            <Badge tone={exp.status === 'completed' ? 'green' : 'amber'}>
              実験 v{exp.version}・{exp.status}・{exp.done}/{exp.total}
            </Badge>
          </>
        }
      />
      {exp.status !== 'completed' && <Callout tone="warn">実験は完了していません（{exp.status}）。表示は、完了したエピソードだけの途中の集計です。</Callout>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="指標">
        {(Object.keys(METRICS) as MetricKey[]).map((k) => (
          <Button key={k} size="sm" variant={metric === k ? 'primary' : 'secondary'} onClick={() => setMetric(k)} role="tab" aria-selected={metric === k}>
            {METRICS[k].label}
          </Button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`${METRICS[metric].label}（条件別の平均と 95% 区間）`} subtitle="区間はエピソード単位の t 区間。n = 条件ごとのエピソード数">
          <BarCI key={metric} data={bars} title={METRICS[metric].label} format={fmt} />
        </Card>
        <Card title="効果の推定（対応のある比較）" subtitle="点 = 推定値、線 = ブートストラップ 95% 区間。0 をまたぐ区間は、効果の向きを確定できないことを示します。">
          {effects.length ? <Forest key={metric} rows={effects.map((e) => ({ label: e.label, estimate: e.estimate, ci: e.ci }))} format={fmtDiff} /> : <p className="text-sm text-slate-600">2×2 の4条件すべての結果が必要です。</p>}
        </Card>
      </div>
      <Card title="推定値の詳細">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3">効果</th>
                <th className="pr-3">推定値</th>
                <th className="pr-3">標準誤差</th>
                <th className="pr-3">95% 区間</th>
                <th className="pr-3">効果量（Cohen の dz）</th>
                <th>エピソード数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="effects">
              {effects.map((e) => (
                <tr key={e.label}>
                  <td className="py-2 pr-3 font-medium text-[#1e2a4a]">{e.label}</td>
                  <td className="pr-3 tabular-nums">{e.estimate === null ? '—' : fmtDiff(e.estimate)}</td>
                  <td className="pr-3 tabular-nums">{e.se === null ? '—' : fmtDiff(e.se)}</td>
                  <td className="pr-3 tabular-nums">{e.ci ? `[${fmtDiff(e.ci[0])}, ${fmtDiff(e.ci[1])}]` : '—'}</td>
                  <td className="pr-3 tabular-nums">{e.cohensDz === null || !Number.isFinite(e.cohensDz) ? '—' : e.cohensDz.toFixed(2)}</td>
                  <td className="tabular-nums">{e.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.byCondition.NR && (
          <p className="mt-3 text-xs text-slate-500">
            規則なし（統制条件）: 平均 {fmt(a.byCondition.NR.mean ?? NaN)}（n={a.byCondition.NR.n}）。規則がない場合の基準として比べます。
          </p>
        )}
        <ul className="mt-4 space-y-1 text-xs text-amber-800">
          {a.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
          <li>⚠ この結果は、Deterministic Demo Agent の方策（デモ用の設計上の仮定）から計算したもので、実際の AI の行動の測定ではありません。</li>
        </ul>
      </Card>
    </div>
  );
}
