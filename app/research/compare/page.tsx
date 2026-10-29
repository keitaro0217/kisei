'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import type { Study } from '@/lib/research/study-types';

// 研究どうしの比較（モデル・プロンプト・市場条件などが異なる研究を並べる）。
// 研究間は同じセッションの対応がないため、記述的な比較であり、差の検定は行わない。

type Row = {
  id: string;
  title: string;
  isMock: boolean;
  frozenHash: string | null;
  model: string;
  prompt: string;
  market: { steps: number; volatility: number; initialPrice: number };
  replicates: number;
  baseSeed: number;
  conditions: {
    id: string;
    label: string;
    completed: number;
    failed: number;
    attempts: number;
    ruleViolationRate: { p: number | null; ci: [number, number] | null };
    intentDeviationRate: { p: number | null };
    meanPnl: number | null;
    costUsd: number;
    meanSessionSeconds: number | null;
  }[];
};

const pct = (p: number | null) => (p === null ? '—' : `${(p * 100).toFixed(1)}%`);

export default function ComparePage() {
  const [studies, setStudies] = useState<Study[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ studies: Study[] }>('/studies')
      .then((r) => setStudies(r.studies.filter((s) => s.frozen)))
      .catch((e) => setError(e.message));
  }, []);

  const compare = async () => {
    setBusy(true);
    setError(null);
    try {
      setRows((await api<{ studies: Row[] }>(`/compare?ids=${selected.join(',')}`)).studies);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="研究の比較"
        description="モデル・プロンプト・市場条件などが異なる研究を並べて比較します。研究どうしは同じセッションの対応がないため記述的な比較です。条件の効果の推定は、1つの研究の中で条件を割り当てて行ってください。"
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="比較する研究（最大4件）">
          {studies === null ? (
            <Loading />
          ) : (
            <div className="space-y-2">
              {studies.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-ink-100">
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    disabled={!selected.includes(s.id) && selected.length >= 4}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))}
                  />
                  {s.design.title}
                  {s.isMock && <Badge className="bg-violet-500/10 text-violet-200 ring-violet-400/30">モック</Badge>}
                </label>
              ))}
              {studies.length === 0 && <p className="text-sm text-ink-300">開始済みの研究がありません。</p>}
              <Button variant="primary" className="mt-2" busy={busy} disabled={selected.length < 2} onClick={compare}>
                比較する
              </Button>
            </div>
          )}
        </Card>
        {rows && (
          <Card title="比較結果">
            <Table head={['研究', '条件', 'エージェント', 'プロンプト', '市場', '完了/失敗', '試行', '規則違反率 [95% CI]', '趣旨逸脱率', '損益の平均', '費用 (USD)', 'セッション時間']}>
              {rows.flatMap((r) =>
                r.conditions.map((c, i) => (
                  <tr key={`${r.id}-${c.id}`}>
                    <td className={td}>
                      {i === 0 && (
                        <Link href={`/research/studies/${r.id}`} className="font-medium text-white underline-offset-2 hover:underline">
                          {r.title}
                        </Link>
                      )}
                      {i === 0 && r.isMock && <span className="ml-1 text-xs text-violet-200">モック</span>}
                    </td>
                    <td className={td}>{c.label}</td>
                    <td className={`${td} text-xs`}>{r.model}</td>
                    <td className={`${td} text-xs`}>{r.prompt}</td>
                    <td className={`${td} text-xs`}>
                      {r.market.steps}ステップ・σ{r.market.volatility}・反復{r.replicates}
                    </td>
                    <td className={td}>
                      {c.completed}/{c.failed}
                    </td>
                    <td className={td}>{c.attempts}</td>
                    <td className={td}>
                      {pct(c.ruleViolationRate.p)}{' '}
                      {c.ruleViolationRate.ci && (
                        <span className="text-xs text-ink-300">
                          [{(c.ruleViolationRate.ci[0] * 100).toFixed(1)}, {(c.ruleViolationRate.ci[1] * 100).toFixed(1)}]
                        </span>
                      )}
                    </td>
                    <td className={td}>{pct(c.intentDeviationRate.p)}</td>
                    <td className={td}>{c.meanPnl === null ? '—' : c.meanPnl.toFixed(0)}</td>
                    <td className={td}>{c.costUsd > 0 ? `$${c.costUsd.toFixed(4)}` : '—'}</td>
                    <td className={td}>{c.meanSessionSeconds === null ? '—' : `${c.meanSessionSeconds.toFixed(2)} 秒`}</td>
                  </tr>
                )),
              )}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
