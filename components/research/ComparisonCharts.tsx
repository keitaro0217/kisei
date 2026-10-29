'use client';

import { useState } from 'react';
import { SERIES_COLORS } from '@/lib/research/study-labels';

// 効果量のフォレストプロットと、条件別のステップごとの規則違反率（時系列）。

const TEXT = '#c3c2b7';
const MUTED = '#8a897f';
const GRID = 'rgba(255,255,255,0.08)';

export type ForestRow = { label: string; estimate: number | null; ci: [number, number] | null; primary: boolean; p: number | null };

/** 規則違反率の差（ポイント）と 95% 区間。0 の縦線をまたぐ区間は差が不確かであることを示す */
export function ForestPlot({ rows, isMock }: { rows: ForestRow[]; isMock: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const valid = rows.filter((r) => r.estimate !== null);
  if (valid.length === 0) return <p className="text-sm text-ink-300">比較できる条件の組がありません。</p>;
  const ext = Math.max(0.05, ...valid.flatMap((r) => [Math.abs(r.estimate!), ...(r.ci ? r.ci.map(Math.abs) : [])]));
  const lim = Math.ceil(ext * 20) / 20;
  const W = 720;
  const rowH = 30;
  const left = 260;
  const right = 24;
  const top = 12;
  const H = top + rows.length * rowH + 36;
  const x = (v: number) => left + ((v + lim) / (2 * lim)) * (W - left - right);
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="条件間の規則違反率の差（フォレストプロット）">
        {isMock && (
          <text x={W - right} y={10} textAnchor="end" fontSize={10} fill={MUTED}>
            モックデータ
          </text>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - 30} stroke={t === 0 ? 'rgba(255,255,255,0.4)' : GRID} />
            <text x={x(t)} y={H - 14} textAnchor="middle" fontSize={11} fill={MUTED}>
              {(t * 100).toFixed(0)} pt
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH + rowH / 2;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill={hover === i ? 'rgba(255,255,255,0.04)' : 'transparent'} />
              <text x={left - 12} y={y + 4} textAnchor="end" fontSize={12} fill={TEXT} fontWeight={r.primary ? 700 : 400}>
                {r.primary ? '★ ' : ''}
                {r.label.length > 30 ? `${r.label.slice(0, 29)}…` : r.label}
              </text>
              {r.ci && <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={y} y2={y} stroke="#f0efec" strokeWidth={2} />}
              {r.estimate !== null && <rect x={x(r.estimate) - 5} y={y - 5} width={10} height={10} fill={SERIES_COLORS[0]} />}
              <title>{`${r.label}: ${r.estimate === null ? '—' : `${(r.estimate * 100).toFixed(1)} pt`}${r.ci ? ` [${(r.ci[0] * 100).toFixed(1)}, ${(r.ci[1] * 100).toFixed(1)}]` : ''}${r.p !== null ? ` p=${r.p.toFixed(3)}` : ''}`}</title>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-ink-300">■ 差（処置 − 対照、プール）、横線は反復単位のブートストラップ 95% 区間。★ は事前に指定した主要比較。</p>
    </div>
  );
}

/** 条件別のステップごとの規則違反率 */
export function StepSeries({ series, isMock }: { series: { label: string; values: (number | null)[] }[]; isMock: boolean }) {
  const steps = Math.max(0, ...series.map((s) => s.values.length));
  if (steps < 2) return null;
  const W = 720;
  const H = 240;
  const M = { top: 14, right: 16, bottom: 30, left: 44 };
  const max = Math.min(1, Math.max(0.1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const yMax = Math.ceil(max * 10) / 10;
  const x = (i: number) => M.left + (i / (steps - 1)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - v / yMax) * (H - M.top - M.bottom);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-ink-100">
            <span className="h-0.5 w-4" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="ステップごとの規則違反率">
        {isMock && (
          <text x={W - M.right} y={12} textAnchor="end" fontSize={10} fill={MUTED}>
            モックデータ
          </text>
        )}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={M.left} x2={W - M.right} y1={y(yMax * f)} y2={y(yMax * f)} stroke={GRID} />
            <text x={M.left - 6} y={y(yMax * f) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
              {Math.round(yMax * f * 100)}%
            </text>
          </g>
        ))}
        {[0, Math.floor((steps - 1) / 2), steps - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={MUTED}>
            {i + 1}
          </text>
        ))}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return <polyline key={s.label} points={pts.join(' ')} fill="none" stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth={2} />;
        })}
      </svg>
      <p className="mt-1 text-xs text-ink-300">横軸はステップ。各点はそのステップの発注・取消の試行に占める規則違反の割合です。</p>
    </div>
  );
}
