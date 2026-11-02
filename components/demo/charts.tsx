'use client';

// 依存ライブラリを使わない SVG のグラフ（棒グラフ＋信頼区間、価格の推移、注文板、効果のフォレストプロット）。

const NAVY = '#0b1f44';
const BLUE = '#2563eb';
const COLORS: Record<string, string> = { 'A-C1': '#93c5fd', 'A-C2': '#2563eb', 'B-C1': '#c4b5fd', 'B-C2': '#6d28d9', NR: '#94a3b8' };

export type BarDatum = { key: string; label: string; value: number | null; ci: [number, number] | null; n: number };

export function BarCI({ data, title, format, height = 220 }: { data: BarDatum[]; title: string; format: (v: number) => string; height?: number }) {
  const w = 560;
  const pad = { l: 56, r: 12, t: 16, b: 44 };
  const vals = data.flatMap((d) => [d.value ?? 0, ...(d.ci ?? [])]);
  const max = Math.max(0.0001, ...vals);
  const min = Math.min(0, ...vals);
  const y = (v: number) => pad.t + ((max - v) / (max - min)) * (height - pad.t - pad.b);
  const bw = (w - pad.l - pad.r) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={title}>
      <title>{title}</title>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = min + (max - min) * f;
        return (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#64748b">
              {format(v)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = pad.l + i * bw + bw * 0.18;
        const bwi = bw * 0.64;
        return (
          <g key={d.key}>
            {d.value !== null && <rect x={x} y={Math.min(y(d.value), y(0))} width={bwi} height={Math.abs(y(0) - y(d.value))} rx={4} fill={COLORS[d.key] ?? BLUE} />}
            {d.ci && (
              <g stroke={NAVY} strokeWidth={1.4}>
                <line x1={x + bwi / 2} x2={x + bwi / 2} y1={y(d.ci[0])} y2={y(d.ci[1])} />
                <line x1={x + bwi / 2 - 6} x2={x + bwi / 2 + 6} y1={y(d.ci[0])} y2={y(d.ci[0])} />
                <line x1={x + bwi / 2 - 6} x2={x + bwi / 2 + 6} y1={y(d.ci[1])} y2={y(d.ci[1])} />
              </g>
            )}
            <text x={x + bwi / 2} y={height - pad.b + 16} textAnchor="middle" fontSize="11" fontWeight={600} fill={NAVY}>
              {d.label}
            </text>
            <text x={x + bwi / 2} y={height - pad.b + 30} textAnchor="middle" fontSize="10" fill="#64748b">
              {d.value === null ? '—' : format(d.value)}（n={d.n}）
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PriceChart({ trades, agentOrders, height = 200, now }: { trades: { t: number; price: number }[]; agentOrders: { t: number; price: number; kind: 'sell' | 'buy' | 'rejected' }[]; height?: number; now: number }) {
  const w = 640;
  const pad = { l: 44, r: 10, t: 10, b: 22 };
  const pts = trades.length ? trades : [{ t: 0, price: 1000 }];
  const prices = [...pts.map((p) => p.price), ...agentOrders.map((o) => o.price)];
  const lo = Math.min(...prices) - 2;
  const hi = Math.max(...prices) + 2;
  const tMax = Math.max(now, 10);
  const x = (t: number) => pad.l + (t / tMax) * (w - pad.l - pad.r);
  const y = (p: number) => pad.t + ((hi - p) / (hi - lo)) * (height - pad.t - pad.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="仮想株価の推移">
      <title>仮想株価の推移（約定価格）と、AI エージェントの注文</title>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={w - pad.r} y1={y(lo + (hi - lo) * f)} y2={y(lo + (hi - lo) * f)} stroke="#e2e8f0" />
          <text x={pad.l - 6} y={y(lo + (hi - lo) * f) + 4} textAnchor="end" fontSize="10" fill="#64748b">
            {Math.round(lo + (hi - lo) * f)}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke={BLUE} strokeWidth={1.8} />
      {agentOrders.map((o, i) => (
        <circle key={i} cx={x(o.t)} cy={y(o.price)} r={3.5} fill={o.kind === 'rejected' ? '#e11d48' : o.kind === 'sell' ? NAVY : '#10b981'} stroke="white" strokeWidth={1} />
      ))}
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
    <div key={`${side}${l.price}`} className="grid grid-cols-[1fr_64px] items-center gap-2 text-xs tabular-nums">
      <div className="relative h-5 overflow-hidden rounded bg-slate-50">
        <div className={`absolute inset-y-0 right-0 ${side === 'bid' ? 'bg-emerald-200/80' : 'bg-rose-200/80'}`} style={{ width: `${(l.qty / max) * 100}%` }} />
        <span className="relative z-10 px-2 leading-5 text-slate-700">
          {l.qty}
          {l.agent && <span className="ml-1 rounded bg-[#0b1f44] px-1 text-[10px] text-white">AI</span>}
        </span>
      </div>
      <span className={`text-right font-medium ${side === 'bid' ? 'text-emerald-700' : 'text-rose-700'}`}>{l.price}</span>
    </div>
  );
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-slate-500">Ask（売り）</p>
      {a.map((l) => row(l, 'ask'))}
      <div className="my-1 flex items-center justify-between rounded-md bg-[#0b1f44] px-2 py-1 text-xs text-white">
        <span>直前の約定価格</span>
        <span className="font-semibold tabular-nums">{last}</span>
      </div>
      {b.map((l) => row(l, 'bid'))}
      <p className="text-[11px] font-medium text-slate-500">Bid（買い）</p>
    </div>
  );
}

export function Forest({ rows, format }: { rows: { label: string; estimate: number | null; ci: [number, number] | null }[]; format: (v: number) => string }) {
  const w = 560;
  const rowH = 34;
  const h = rows.length * rowH + 24;
  const vals = rows.flatMap((r) => [r.estimate ?? 0, ...(r.ci ?? [])]);
  const lim = Math.max(1e-6, ...vals.map(Math.abs));
  // 左に効果の名前（200px）、右に数値（80px）の余白をとる
  const x = (v: number) => 210 + ((v + lim) / (2 * lim)) * (w - 300);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="効果の推定と95%区間">
      <title>効果の推定（点）と 95% 区間（線）</title>
      <line x1={x(0)} x2={x(0)} y1={6} y2={h - 18} stroke="#94a3b8" strokeDasharray="3 3" />
      {rows.map((r, i) => {
        const cy = 18 + i * rowH;
        return (
          <g key={r.label}>
            <text x={8} y={cy + 4} fontSize="11" fill={NAVY}>
              {r.label}
            </text>
            {r.ci && <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={cy} y2={cy} stroke={NAVY} strokeWidth={2} />}
            {r.estimate !== null && <circle cx={x(r.estimate)} cy={cy} r={5} fill={BLUE} />}
            <text x={w - 6} y={cy + 4} textAnchor="end" fontSize="10" fill="#64748b">
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
