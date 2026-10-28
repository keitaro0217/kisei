'use client';

import { useRef, useState } from 'react';
import { SERIES_COLORS } from '@/lib/research/study-labels';
import { Button } from './ui';

// 条件ごとの比率（95% Wilson 区間つき）を指標ごとに並べた棒グラフ。
// 条件の色は固定順で割り当て、凡例と表（研究結果の表）を併記して色だけに頼らない。

export type ChartSeries = { id: string; label: string; values: { p: number | null; ci: [number, number] | null; k: number; n: number }[] };

const W = 720;
const H = 300;
const M = { top: 16, right: 16, bottom: 44, left: 48 };
const TEXT = '#c3c2b7';
const MUTED = '#8a897f';
const GRID = 'rgba(255,255,255,0.08)';

export default function StudyChart({ metrics, series, title, isMock }: { metrics: string[]; series: ChartSeries[]; title: string; isMock: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const max = Math.min(1, Math.max(0.05, ...series.flatMap((s) => s.values.map((v) => v.ci?.[1] ?? v.p ?? 0))));
  const yMax = Math.ceil(max * 10) / 10;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const groupW = plotW / metrics.length;
  const barW = Math.min(36, (groupW * 0.7) / Math.max(series.length, 1));
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;
  const ticks = Array.from({ length: 6 }, (_, i) => (yMax * i) / 5);

  const download = async (kind: 'svg' | 'png') => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const name = `chart${isMock ? '-MOCK' : ''}`;
    const save = (url: string, ext: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.${ext}`;
      a.click();
    };
    const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    if (kind === 'svg') {
      save(svgUrl, 'svg');
      setTimeout(() => URL.revokeObjectURL(svgUrl), 1000);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W * 2;
      canvas.height = H * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(svgUrl);
      save(canvas.toDataURL('image/png'), 'png');
    };
    img.src = svgUrl;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {series.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5 text-xs text-ink-100">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden />
            {s.label}
          </span>
        ))}
        <span className="ml-auto flex gap-2">
          <Button onClick={() => download('svg')}>SVG で保存</Button>
          <Button onClick={() => download('png')}>PNG で保存</Button>
        </span>
      </div>
      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
          <rect x={0} y={0} width={W} height={H} fill="#141413" />
          {isMock && (
            <text x={W - M.right} y={M.top + 4} textAnchor="end" fontSize={11} fill={MUTED}>
              モックデータ（AIの判断ではありません）
            </text>
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {metrics.map((m, mi) => {
            const gx = M.left + groupW * mi + (groupW - barW * series.length - 2 * (series.length - 1)) / 2;
            return (
              <g key={m}>
                <text x={M.left + groupW * mi + groupW / 2} y={H - M.bottom + 20} textAnchor="middle" fontSize={12} fill={TEXT}>
                  {m}
                </text>
                {series.map((s, si) => {
                  const v = s.values[mi];
                  const x = gx + si * (barW + 2);
                  const color = SERIES_COLORS[si % SERIES_COLORS.length];
                  const tip = `${s.label} / ${m}: ${v.p === null ? 'データなし' : `${(v.p * 100).toFixed(1)}%（${v.k}/${v.n}）`}${v.ci ? ` 95%CI ${(v.ci[0] * 100).toFixed(1)}–${(v.ci[1] * 100).toFixed(1)}%` : ''}`;
                  const top = v.p === null ? y(0) : y(v.p);
                  const h = Math.max(0, y(0) - top);
                  return (
                    <g
                      key={s.id}
                      onMouseMove={(e) => {
                        const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                        setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: tip });
                      }}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>{tip}</title>
                      {/* 当たり判定を棒より広くする */}
                      <rect x={x - 1} y={M.top} width={barW + 2} height={plotH} fill="transparent" />
                      {h > 0 && <path d={`M${x},${y(0)} V${top + Math.min(4, h)} q0,-4 4,-4 H${x + barW - 4} q4,0 4,4 V${y(0)} Z`} fill={color} />}
                      {v.ci && (
                        <g stroke="#f0efec" strokeWidth={1.5}>
                          <line x1={x + barW / 2} x2={x + barW / 2} y1={y(v.ci[0])} y2={y(v.ci[1])} />
                          <line x1={x + barW / 2 - 4} x2={x + barW / 2 + 4} y1={y(v.ci[1])} y2={y(v.ci[1])} />
                          <line x1={x + barW / 2 - 4} x2={x + barW / 2 + 4} y1={y(v.ci[0])} y2={y(v.ci[0])} />
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.25)" />
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-md bg-ink-950/95 px-2.5 py-1.5 text-xs text-white shadow-lg ring-1 ring-white/15"
            style={{ left: Math.min(hover.x + 12, 520), top: hover.y + 12 }}
          >
            {hover.text}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-300">ひげは 95% Wilson 区間（判断を独立と仮定した参考値）。条件間の推測には下の比較表（反復単位のブートストラップ・並べ替え検定）を使ってください。</p>
    </div>
  );
}
