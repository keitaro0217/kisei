'use client';

import { useId, useState } from 'react';

// 依存ライブラリを使わない SVG のグラフ（棒グラフ＋信頼区間、価格の推移、注文板、効果のフォレストプロット）。
// 動き: 初回表示で棒が伸びる・線が描かれる・点が現れる。値が変わると位置・高さがなめらかに変化する。
// 動きを減らす設定（prefers-reduced-motion）では、globals.css の指定で動きを止める。

const NAVY = '#1e2a4a';
const BLUE = '#2563eb';
const COLORS: Record<string, string> = { 'A-C1': '#93c5fd', 'A-C2': '#2563eb', 'B-C1': '#c4b5fd', 'B-C2': '#6d28d9', NR: '#94a3b8' };

export type BarDatum = { key: string; label: string; value: number | null; ci: [number, number] | null; n: number };

export function BarCI({ data, title, format, height = 240 }: { data: BarDatum[]; title: string; format: (v: number) => string; height?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const gid = useId().replace(/:/g, '');
  const w = 560;
  const pad = { l: 56, r: 12, t: 26, b: 44 };
  const vals = data.flatMap((d) => [d.value ?? 0, ...(d.ci ?? [])]);
  const max = Math.max(0.0001, ...vals);
  const min = Math.min(0, ...vals);
  const y = (v: number) => pad.t + ((max - v) / (max - min)) * (height - pad.t - pad.b);
  const bw = (w - pad.l - pad.r) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
      <title>{title}</title>
      <defs>
        {data.map((d) => (
          <linearGradient key={d.key} id={`${gid}-${d.key}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={COLORS[d.key] ?? BLUE} stopOpacity={1} />
            <stop offset="100%" stopColor={COLORS[d.key] ?? BLUE} stopOpacity={0.65} />
          </linearGradient>
        ))}
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = min + (max - min) * f;
        return (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeDasharray={f === 0 ? undefined : '3 4'} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#64748b">
              {format(v)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = pad.l + i * bw + bw * 0.18;
        const bwi = bw * 0.64;
        const dim = hover !== null && hover !== d.key;
        const top = d.value === null ? y(0) : Math.min(y(d.value), y(0));
        const h = d.value === null ? 0 : Math.abs(y(0) - y(d.value));
        return (
          <g key={d.key} onMouseEnter={() => setHover(d.key)} style={{ opacity: dim ? 0.35 : 1, transition: 'opacity 0.25s ease' }}>
            <rect x={pad.l + i * bw} y={pad.t} width={bw} height={height - pad.t - pad.b} fill={hover === d.key ? '#eef2ff' : 'transparent'} rx={8} />
            {d.value !== null && (
              <g className="kd-grow-y" style={{ animationDelay: `${i * 90}ms` }}>
                <rect className="kd-geo" x={x} width={bwi} rx={5} fill={`url(#${gid}-${d.key})`} style={{ y: top, height: h }} />
              </g>
            )}
            {d.ci && (
              <g stroke={NAVY} strokeWidth={1.4} className="kd-fade" style={{ animationDelay: `${450 + i * 90}ms` }}>
                <line x1={x + bwi / 2} x2={x + bwi / 2} y1={y(d.ci[0])} y2={y(d.ci[1])} />
                <line x1={x + bwi / 2 - 6} x2={x + bwi / 2 + 6} y1={y(d.ci[0])} y2={y(d.ci[0])} />
                <line x1={x + bwi / 2 - 6} x2={x + bwi / 2 + 6} y1={y(d.ci[1])} y2={y(d.ci[1])} />
              </g>
            )}
            {d.value !== null && (
              <text x={x + bwi / 2} y={Math.max(12, (d.ci ? y(d.ci[1]) : top) - 6)} textAnchor="middle" fontSize="11" fontWeight={700} fill={NAVY} className="kd-fade" style={{ animationDelay: `${600 + i * 90}ms` }}>
                {format(d.value)}
              </text>
            )}
            <text x={x + bwi / 2} y={height - pad.b + 16} textAnchor="middle" fontSize="11" fontWeight={600} fill={NAVY}>
              {d.label}
            </text>
            <text x={x + bwi / 2} y={height - pad.b + 30} textAnchor="middle" fontSize="10" fill="#64748b">
              {d.value === null ? '—' : `n=${d.n}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PriceChart({ trades, agentOrders, height = 220, now }: { trades: { t: number; price: number }[]; agentOrders: { t: number; price: number; kind: 'sell' | 'buy' | 'rejected' }[]; height?: number; now: number }) {
  const gid = useId().replace(/:/g, '');
  const w = 640;
  const pad = { l: 44, r: 56, t: 12, b: 22 };
  const pts = trades.length ? trades : [{ t: 0, price: 1000 }];
  const prices = [...pts.map((p) => p.price), ...agentOrders.map((o) => o.price)];
  const lo = Math.min(...prices) - 2;
  const hi = Math.max(...prices) + 2;
  const tMax = Math.max(now, 10);
  const x = (t: number) => pad.l + (t / tMax) * (w - pad.l - pad.r);
  const y = (p: number) => pad.t + ((hi - p) / (hi - lo)) * (height - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : last;
  const area = `${path} L${x(last.t).toFixed(1)},${height - pad.b} L${x(pts[0].t).toFixed(1)},${height - pad.b} Z`;
  const up = last.price >= prev.price;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="仮想株価の推移">
      <title>仮想株価の推移（約定価格）と、AI エージェントの注文</title>
      <defs>
        <linearGradient id={`${gid}-area`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity={0.22} />
          <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={w - pad.r} y1={y(lo + (hi - lo) * f)} y2={y(lo + (hi - lo) * f)} stroke="#e2e8f0" strokeDasharray="3 4" />
          <text x={pad.l - 6} y={y(lo + (hi - lo) * f) + 4} textAnchor="end" fontSize="10" fill="#64748b">
            {Math.round(lo + (hi - lo) * f)}
          </text>
        </g>
      ))}
      <path d={area} fill={`url(#${gid}-area)`} className="kd-fade" />
      <path d={path} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="kd-draw" />
      {/* 直前の約定価格の水平線とラベル */}
      <line x1={pad.l} x2={w - pad.r} y1={y(last.price)} y2={y(last.price)} stroke={up ? '#10b981' : '#e11d48'} strokeOpacity={0.55} strokeDasharray="4 4" className="kd-geo" />
      <g style={{ transform: `translateY(${y(last.price)}px)`, transition: 'transform 0.35s ease' }}>
        <rect x={w - pad.r + 4} y={-9} width={pad.r - 6} height={18} rx={5} fill={up ? '#10b981' : '#e11d48'} />
        <text x={w - pad.r + 4 + (pad.r - 6) / 2} y={4} textAnchor="middle" fontSize="10" fontWeight={700} fill="white">
          {Math.round(last.price)}
        </text>
      </g>
      {agentOrders.map((o, i) => (
        <circle key={`${o.t}-${i}`} className="kd-pop" cx={x(o.t)} cy={y(o.price)} r={o.kind === 'rejected' ? 4.5 : 3.8} fill={o.kind === 'rejected' ? '#e11d48' : o.kind === 'sell' ? NAVY : '#10b981'} stroke="white" strokeWidth={1.2} />
      ))}
      {/* 最新の価格の位置（脈打つ点） */}
      <circle cx={x(last.t)} cy={y(last.price)} r={4} fill={BLUE} className="kd-pulse kd-motion-only" />
      <circle cx={x(last.t)} cy={y(last.price)} r={4} fill={BLUE} stroke="white" strokeWidth={1.5} />
      <text x={w - pad.r} y={height - 6} textAnchor="end" fontSize="10" fill="#64748b">
        t = {now}
      </text>
    </svg>
  );
}

export function DepthBook({ bids, asks, last }: { bids: { price: number; qty: number; owner: string }[]; asks: { price: number; qty: number; owner: string }[]; last: number }) {
  const levels = (os: { price: number; qty: number; owner: string }[]) => {
    const m = new Map<number, { qty: number; agent: boolean }>();
    for (const o of os) {
      const e = m.get(o.price) ?? { qty: 0, agent: false };
      e.qty += o.qty;
      e.agent ||= o.owner === 'demo-agent-1';
      m.set(o.price, e);
    }
    return [...m.entries()].map(([price, v]) => ({ price, ...v }));
  };
  const b = levels(bids).sort((x, y) => y.price - x.price).slice(0, 6);
  const a = levels(asks).sort((x, y) => x.price - y.price).slice(0, 6).reverse();
  const max = Math.max(1, ...b.map((x) => x.qty), ...a.map((x) => x.qty));
  const row = (l: { price: number; qty: number; agent: boolean }, side: 'bid' | 'ask') => (
    <div key={`${side}${l.price}`} className="kd-rise grid grid-cols-[1fr_64px] items-center gap-2 text-xs tabular-nums">
      <div className="relative h-5 overflow-hidden rounded bg-slate-50">
        <div
          className={`absolute inset-y-0 right-0 rounded transition-[width] duration-500 ease-out ${side === 'bid' ? 'bg-gradient-to-l from-emerald-300/90 to-emerald-100/70' : 'bg-gradient-to-l from-rose-300/90 to-rose-100/70'}`}
          style={{ width: `${(l.qty / max) * 100}%` }}
        />
        <span className="relative z-10 px-2 leading-5 text-slate-700">
          {l.qty}
          {l.agent && <span className="ml-1 rounded bg-[#1e2a4a] px-1 text-[10px] text-white">AI</span>}
        </span>
      </div>
      <span className={`text-right font-medium ${side === 'bid' ? 'text-emerald-700' : 'text-rose-700'}`}>{l.price}</span>
    </div>
  );
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-slate-500">Ask（売り）</p>
      {a.map((l) => row(l, 'ask'))}
      <div key={last} className="kd-flash my-1 flex items-center justify-between rounded-md bg-[#1e2a4a] px-2 py-1 text-xs text-white">
        <span>直前の約定価格</span>
        <span className="font-semibold tabular-nums">{last}</span>
      </div>
      {b.map((l) => row(l, 'bid'))}
      <p className="text-[11px] font-medium text-slate-500">Bid（買い）</p>
    </div>
  );
}

export function Forest({ rows, format }: { rows: { label: string; estimate: number | null; ci: [number, number] | null }[]; format: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const w = 560;
  const rowH = 38;
  const h = rows.length * rowH + 26;
  const vals = rows.flatMap((r) => [r.estimate ?? 0, ...(r.ci ?? [])]);
  const lim = Math.max(1e-6, ...vals.map(Math.abs));
  // 左に効果の名前（200px）、右に数値（80px）の余白をとる
  const x = (v: number) => 210 + ((v + lim) / (2 * lim)) * (w - 300);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="効果の推定と95%区間" onMouseLeave={() => setHover(null)}>
      <title>効果の推定（点）と 95% 区間（線）</title>
      <rect x={x(-lim)} y={4} width={x(0) - x(-lim)} height={h - 24} fill="#fff1f2" opacity={0.5} />
      <rect x={x(0)} y={4} width={x(lim) - x(0)} height={h - 24} fill="#eef2ff" opacity={0.6} />
      <line x1={x(0)} x2={x(0)} y1={4} y2={h - 18} stroke="#94a3b8" strokeDasharray="3 3" />
      {rows.map((r, i) => {
        const cy = 20 + i * rowH;
        const crosses = r.ci ? r.ci[0] <= 0 && r.ci[1] >= 0 : true;
        const color = crosses ? '#64748b' : BLUE;
        return (
          <g key={r.label} onMouseEnter={() => setHover(r.label)} style={{ opacity: hover && hover !== r.label ? 0.35 : 1, transition: 'opacity 0.25s ease' }}>
            {hover === r.label && <rect x={0} y={cy - rowH / 2 + 2} width={w} height={rowH - 4} rx={6} fill="#f8fafc" />}
            <text x={8} y={cy + 4} fontSize="11" fill={NAVY} fontWeight={hover === r.label ? 700 : 400}>
              {r.label}
            </text>
            {r.ci && (
              <g className="kd-grow-x" style={{ animationDelay: `${i * 120}ms` }}>
                <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={cy} y2={cy} stroke={NAVY} strokeWidth={2.2} strokeLinecap="round" />
                <line x1={x(r.ci[0])} x2={x(r.ci[0])} y1={cy - 5} y2={cy + 5} stroke={NAVY} strokeWidth={1.6} />
                <line x1={x(r.ci[1])} x2={x(r.ci[1])} y1={cy - 5} y2={cy + 5} stroke={NAVY} strokeWidth={1.6} />
              </g>
            )}
            {r.estimate !== null && <circle className="kd-pop" style={{ animationDelay: `${300 + i * 120}ms` }} cx={x(r.estimate)} cy={cy} r={6} fill={color} stroke="white" strokeWidth={1.5} />}
            <text x={w - 6} y={cy + 4} textAnchor="end" fontSize="10.5" fontWeight={600} fill={color}>
              {r.estimate === null ? '—' : format(r.estimate)}
            </text>
          </g>
        );
      })}
      <text x={x(0)} y={h - 4} textAnchor="middle" fontSize="10" fill="#64748b">
        0（差なし）
      </text>
    </svg>
  );
}
