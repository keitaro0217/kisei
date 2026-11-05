'use client';

import { useRouter } from 'next/navigation';

// 研究パイプラインの全体像（合成規則 → AI エージェント → 仮想市場 → デュアル評価 → 因果分析 → 修正と検証）。
// 各ノードはクリックで該当の画面へ移動する。

type Node = { key: string; label: string; color: string; href: string; icon: string; top?: string[]; bottom?: string[]; side?: string[] };

const NODES: Node[] = [
  { key: 'rules', label: '合成規則', color: '#1e2a4a', href: '/demo/research/rules', icon: 'doc', side: ['条文A（新規に）', '条文B', '規制趣旨', '参照文書', '適用条件'] },
  { key: 'agent', label: 'AI エージェント', color: '#8b5cf6', href: '/demo/research/trace', icon: 'agent', top: ['市場観測', '規制確認'], bottom: ['取引判断', '再判断'] },
  { key: 'market', label: '仮想市場', color: '#2fa57a', href: '/demo/research/market', icon: 'chart', top: ['Bid', 'Ask'], bottom: ['約定', '訂正・取消'] },
  { key: 'grading', label: 'デュアル評価', color: '#ef8a3a', href: '/demo/research/grading', icon: 'scale', top: ['Build 軸', 'Judge 軸'], bottom: ['形式違反', '趣旨逸脱候補'] },
  { key: 'causal', label: '因果分析', color: '#d9a400', href: '/demo/research/analysis', icon: 'bars', top: ['文言の効果', '趣旨説明の効果'], bottom: ['交互作用', '95% 区間'] },
  { key: 'patch', label: '修正と検証', color: '#3b6fe0', href: '/demo/research/patch', icon: 'check', side: ['修正案', 'サンドボックス', '同シードで再実験', '副作用（誤拒否）', '研究レポート'] },
];

const ICONS: Record<string, string> = {
  doc: 'M7 3h7l4 4v14H7z M14 3v4h4 M9.5 11h6 M9.5 14.5h6 M9.5 18h4',
  agent: 'M6 9h12v9H6z M9 6h6v3H9z M9.5 13h0.01 M14.5 13h0.01 M10 16h4 M12 3v3',
  chart: 'M4 19h16 M5 15l4-5 3 3 4-6 3 3',
  scale: 'M12 4v16 M7 20h10 M5 8h14 M5 8l-2.5 6h5z M19 8l-2.5 6h5z',
  bars: 'M5 19V11 M10 19V6 M15 19v-9 M20 19v-5 M3 19h18',
  check: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M8.5 12l2.5 2.5 4.5-5',
};

export default function PipelineGraph() {
  const router = useRouter();
  const W = 1440;
  const H = 300;
  const cy = 140;
  const xs = [220, 430, 640, 850, 1060, 1210];
  const R = 46;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[900px] w-full" role="img" aria-label="研究パイプラインの全体像">
        <title>研究パイプライン: 合成規則 → AI エージェント → 仮想市場 → デュアル評価 → 因果分析 → 修正と検証</title>
        <defs>
          <linearGradient id="kd-pipe" x1="0" x2="1" y1="0" y2="0">
            {NODES.map((n, i) => (
              <stop key={n.key} offset={`${(i / (NODES.length - 1)) * 100}%`} stopColor={n.color} />
            ))}
          </linearGradient>
        </defs>
        <line x1={xs[0]} x2={xs[5]} y1={cy} y2={cy} stroke="#e2e8f0" strokeWidth={4} strokeLinecap="round" />
        {/* 工程の流れ（左から右へ流れる破線と、移動する点） */}
        <line x1={xs[0]} x2={xs[5]} y1={cy} y2={cy} stroke="url(#kd-pipe)" strokeWidth={3} strokeLinecap="round" className="kd-flow" />
        {[0, 1, 2].map((k) => (
          <circle key={k} r={5} fill="#4f46e5" opacity={0.85} className="kd-motion-only">
            <animateMotion dur="6s" begin={`${k * 2}s`} repeatCount="indefinite" path={`M${xs[0]},${cy} L${xs[5]},${cy}`} />
          </circle>
        ))}
        {NODES.map((n, i) => {
          const x = xs[i];
          const sat: { label: string; sx: number; sy: number; anchor: 'start' | 'middle' | 'end'; lx: number; ly: number }[] = [];
          if (n.side) {
            const left = i === 0;
            n.side.forEach((label, k) => {
              const sy = cy - 72 + k * 36;
              const sx = left ? x - 90 : x + 90;
              sat.push({ label, sx, sy, anchor: left ? 'end' : 'start', lx: left ? sx - 14 : sx + 14, ly: sy + 4 });
            });
          }
          (n.top ?? []).forEach((label, k) => {
            const sx = x + (k === 0 ? -56 : 56);
            sat.push({ label, sx, sy: cy - 92, anchor: 'middle', lx: sx, ly: cy - 110 });
          });
          (n.bottom ?? []).forEach((label, k) => {
            const sx = x + (k === 0 ? -56 : 56);
            sat.push({ label, sx, sy: cy + 92, anchor: 'middle', lx: sx, ly: cy + 122 });
          });
          return (
            <g
              key={n.key}
              role="link"
              tabIndex={0}
              aria-label={`${n.label}の画面へ`}
              className="kd-rise cursor-pointer focus:outline-none [&:hover_circle.main]:stroke-[3.5] [&:focus_circle.main]:stroke-[3.5]"
              style={{ animationDelay: `${i * 110}ms` }}
              onClick={() => router.push(n.href)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && router.push(n.href)}
            >
              {sat.map((s, k) => (
                <g key={s.label} className="kd-fade" style={{ animationDelay: `${300 + i * 110 + k * 60}ms` }}>
                  <line x1={x} y1={cy} x2={s.sx} y2={s.sy} stroke={n.color} strokeOpacity={0.28} strokeWidth={1.5} />
                  <circle cx={s.sx} cy={s.sy} r={7} fill="white" stroke={n.color} strokeWidth={2} />
                  <text x={s.lx} y={s.ly} textAnchor={s.anchor} fontSize={15} fill={n.side ? '#1e2a4a' : n.color} fontWeight={500}>
                    {s.label}
                  </text>
                </g>
              ))}
              <circle cx={x} cy={cy} r={R} fill={n.color} className="kd-halo kd-motion-only" style={{ animationDelay: `${i * 0.5}s` }} />
              <g className="kd-node">
              <circle className="main" cx={x} cy={cy} r={R} fill="white" stroke={n.color} strokeWidth={2.5} style={{ filter: 'drop-shadow(0 4px 10px rgba(30,42,74,0.08))' }} />
              <circle cx={x} cy={cy} r={R - 9} fill={n.color} fillOpacity={0.06} />
              <g transform={`translate(${x - 15} ${cy - 15}) scale(1.25)`} fill="none" stroke={n.color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS[n.icon]} />
              </g>
              <text x={x} y={n.top || n.bottom ? cy + 70 : cy + 72} textAnchor="middle" fontSize={17} fontWeight={700} fill={n.color}>
                {n.label}
              </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
