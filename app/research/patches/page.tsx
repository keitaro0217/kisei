'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { GateResult, Patch, RegressionRun } from '@/lib/research/patch-types';
import { gateLabels, patchCategoryLabels, patchStatusLabels } from '@/lib/research/study-labels';

// 修正案の一覧。リスク低減と誤拒否の増加の両方で比較し、他の案に劣らない案（パレート最適）を示す。

type Item = { patch: Patch; latest: { id: string; gate: GateResult; metrics: RegressionRun['metrics']; createdAt: string } | null; pareto: boolean };

const pt = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pt`);

function ParetoChart({ items }: { items: Item[] }) {
  const pts = items.filter((i) => i.latest?.metrics.riskReduction != null && i.latest.metrics.falseRejectionIncrease != null);
  if (pts.length === 0) return <p className="text-sm text-ink-300">回帰テストを実行した修正案がまだありません。</p>;
  const W = 520;
  const H = 300;
  const M = 44;
  const x = (v: number) => M + ((v + 1) / 2) * (W - 2 * M);
  const y = (v: number) => H - M - ((v + 1) / 2) * (H - 2 * M);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label="リスク低減と誤拒否の増加">
      <line x1={x(0)} x2={x(0)} y1={M / 2} y2={H - M} stroke="rgba(255,255,255,0.3)" />
      <line x1={M} x2={W - M / 2} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.3)" />
      <text x={W / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#8a897f">
        誤拒否の増加（左ほどよい）
      </text>
      <text x={12} y={H / 2} textAnchor="middle" fontSize={11} fill="#8a897f" transform={`rotate(-90 12 ${H / 2})`}>
        リスク低減（上ほどよい）
      </text>
      {pts.map((i, n) => (
        <g key={i.patch.id}>
          <circle cx={x(i.latest!.metrics.falseRejectionIncrease!)} cy={y(i.latest!.metrics.riskReduction!)} r={i.pareto ? 7 : 5} fill={i.pareto ? '#199e70' : '#8a897f'} stroke="#141413" strokeWidth={2} />
          <text x={x(i.latest!.metrics.falseRejectionIncrease!) + 9} y={y(i.latest!.metrics.riskReduction!) + 4} fontSize={10} fill="#c3c2b7">
            {n + 1}
          </text>
          <title>{`${n + 1}. ${i.patch.title}: リスク低減 ${pt(i.latest!.metrics.riskReduction)}・誤拒否 ${pt(i.latest!.metrics.falseRejectionIncrease)}${i.pareto ? '（パレート最適）' : ''}`}</title>
        </g>
      ))}
    </svg>
  );
}

export default function PatchesPage() {
  const basic = useBasicSettings() ?? undefined;
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: Item[] }>('/patches')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, []);
  const tested = (items ?? []).filter((i) => i.latest?.metrics.riskReduction != null && i.latest.metrics.falseRejectionIncrease != null);

  return (
    <>
      <PageHeader
        title="Auto-Patch"
        description="Failure と原因の候補から作った修正案を、回帰テストと再実験で検証します。修正案は仮想環境の実験だけに使い、元の規則・業務設定・取引システムへ自動で反映することはありません。修正案は Failure Library のクラスターや原因の候補の画面から作成します。"
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="読み込みに失敗しました">
            {error}
          </Alert>
        </div>
      )}
      {!items ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <Card title="リスク低減と副作用" description="緑の点は、リスク低減と誤拒否の増加の両方で他の案に劣らない案（パレート最適）です。単一のスコアでは選びません。点の番号は下の表の順番です。">
            <ParetoChart items={tested} />
          </Card>
          <Card title="修正案">
            <Table head={['#', '修正案', '種類', '対象', '状態', '最新の回帰テスト', 'リスク低減', '誤拒否の増加', '作成']} empty="修正案はまだありません（Failure Library から作成します）">
              {items.map((i) => (
                <tr key={i.patch.id}>
                  <td className={td}>{tested.indexOf(i) >= 0 ? tested.indexOf(i) + 1 : ''}</td>
                  <td className={`${td} max-w-sm whitespace-normal`}>
                    <Link href={`/research/patches/${i.patch.id}`} className="font-medium text-white underline-offset-2 hover:underline">
                      {i.patch.title}
                    </Link>
                    {i.pareto && <span className="ml-2 text-xs text-emerald-300">パレート最適</span>}
                    {i.patch.isMock && <span className="ml-2 text-xs text-violet-200">モック由来</span>}
                  </td>
                  <td className={td}>{patchCategoryLabels[i.patch.category]}</td>
                  <td className={`${td} font-mono text-xs`}>{i.patch.targetRuleKey}</td>
                  <td className={td}>
                    <Badge className={patchStatusLabels[i.patch.status].className}>{patchStatusLabels[i.patch.status].label}</Badge>
                  </td>
                  <td className={td}>{i.latest ? <Badge className={gateLabels[i.latest.gate].className}>{gateLabels[i.latest.gate].label}</Badge> : '—'}</td>
                  <td className={td}>{pt(i.latest?.metrics.riskReduction ?? null)}</td>
                  <td className={td}>{pt(i.latest?.metrics.falseRejectionIncrease ?? null)}</td>
                  <td className={td}>{formatDate(i.patch.createdAt, basic)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
