'use client';

import { Card, Table, td } from '@/components/research/ui';
import type { DomainComparison, DomainConditionStats } from '@/lib/server/domain/stats';

// 金融以外のドメインの研究の結果（条件ごとの率と、反復単位の比較）
type Props = { stats: { domain: string; conditions: DomainConditionStats[]; comparisons: DomainComparison[]; notes: string[] } };

const pct = (p: { p: number | null; ci: [number, number] | null; k: number; n: number }) =>
  p.p === null ? '—' : `${(p.p * 100).toFixed(1)}%${p.ci ? ` [${(p.ci[0] * 100).toFixed(1)}, ${(p.ci[1] * 100).toFixed(1)}]` : ''}（${p.k}/${p.n}）`;
const METRIC_LABEL: Record<string, string> = { formal_violation_rate: '形式違反率', intent_deviation_rate: '趣旨逸脱率' };

export default function DomainStatsCard({ stats }: Props) {
  const metricKeys = [...new Set(stats.conditions.flatMap((c) => Object.keys(c.metrics)))];
  return (
    <>
      <Card title="条件ごとの結果" description={stats.notes.join(' ')}>
        <Table head={['条件', 'セッション', '形式違反率', '趣旨逸脱率', '正常処理の成功率', '解釈不能', '業務の報酬（平均）']}>
          {stats.conditions.map((c) => (
            <tr key={c.conditionId}>
              <td className={td}>{c.label}</td>
              <td className={td}>{c.sessions}</td>
              <td className={`${td} text-xs`}>{pct(c.formalViolationRate)}</td>
              <td className={`${td} text-xs`}>{pct(c.intentDeviationRate)}</td>
              <td className={`${td} text-xs`}>{pct(c.normalSuccessRate)}</td>
              <td className={`${td} text-xs`}>{pct(c.invalidRate)}</td>
              <td className={td}>{c.meanReward === null ? '—' : c.meanReward.toFixed(2)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      {metricKeys.length > 0 && (
        <Card title="業務の指標（エピソードの平均）">
          <Table head={['条件', ...metricKeys]}>
            {stats.conditions.map((c) => (
              <tr key={c.conditionId}>
                <td className={td}>{c.label}</td>
                {metricKeys.map((k) => (
                  <td key={k} className={td}>
                    {c.metrics[k]?.toLocaleString() ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {stats.comparisons.length > 0 && (
        <Card title="主要比較（反復単位の対応のある比較）" description="差 = 処置 − 対照。区間は反復単位のブートストラップ 95%、p 値は符号反転の並べ替え検定です。">
          <Table head={['指標', '処置', '対照', '対応のある反復', '差', '95% 区間', 'p 値']}>
            {stats.comparisons.map((c) => (
              <tr key={c.metric}>
                <td className={td}>{METRIC_LABEL[c.metric]}</td>
                <td className={td}>{c.treatment}</td>
                <td className={td}>{c.control}</td>
                <td className={td}>{c.pairedReplicates}</td>
                <td className={td}>{c.diff === null ? '—' : `${(c.diff * 100).toFixed(1)} pt`}</td>
                <td className={td}>{c.ci ? `[${(c.ci[0] * 100).toFixed(1)}, ${(c.ci[1] * 100).toFixed(1)}]` : '—'}</td>
                <td className={td}>{c.permutationP === null ? '—' : c.permutationP < 0.001 ? '< 0.001' : c.permutationP.toFixed(3)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
