'use client';

import Link from 'next/link';
import type { GraphEdge, GraphNode } from '@/lib/research/failure-types';

// 証拠グラフ: 規則 → 提示 → 判断 → 行動 → Failure ← 仮説 → 検証実験 → 効果 を左から右に並べる。
// 実線はデータで確認できる関係、破線は未検証の因果（仮説）を表す。

const COLUMNS: GraphNode['kind'][] = ['rule', 'document', 'decision', 'action', 'failure', 'hypothesis', 'experiment', 'effect'];
const KIND_LABEL: Record<GraphNode['kind'], string> = {
  rule: '規則',
  document: '提示',
  decision: '判断',
  action: '行動',
  failure: 'Failure',
  hypothesis: '原因の候補',
  experiment: '検証実験',
  effect: '効果の推定',
};

export default function EvidenceGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const used = COLUMNS.filter((k) => nodes.some((n) => n.kind === k));
  const W = Math.max(720, used.length * 150);
  const colW = W / used.length;
  const nodeW = colW - 24;
  const nodeH = 40;
  const gap = 14;
  const rows = Math.max(...used.map((k) => nodes.filter((n) => n.kind === k).length));
  const H = 40 + rows * (nodeH + gap) + 10;
  const pos = new Map<string, { x: number; y: number }>();
  used.forEach((k, ci) => {
    const col = nodes.filter((n) => n.kind === k);
    const offset = (rows - col.length) * ((nodeH + gap) / 2);
    col.forEach((n, ri) => pos.set(n.id, { x: ci * colW + 12, y: 34 + offset + ri * (nodeH + gap) }));
  });
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W }} className="w-full" role="img" aria-label="証拠グラフ">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a897f" />
          </marker>
        </defs>
        {used.map((k, ci) => (
          <text key={k} x={ci * colW + colW / 2} y={18} textAnchor="middle" fontSize={11} fill="#8a897f">
            {KIND_LABEL[k]}
          </text>
        ))}
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          // 仮説 → Failure は右から左へ向かう
          const reverse = b.x < a.x;
          const x1 = reverse ? a.x : a.x + nodeW;
          const x2 = reverse ? b.x + nodeW : b.x;
          return (
            <g key={i}>
              <line x1={x1} y1={a.y + nodeH / 2} x2={x2} y2={b.y + nodeH / 2} stroke={e.verified ? '#c3c2b7' : '#d95926'} strokeWidth={1.5} strokeDasharray={e.verified ? undefined : '5 4'} markerEnd="url(#arrow)" />
              <title>{`${e.label}${e.verified ? '（確認済み）' : '（未検証）'}`}</title>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const box = (
            <g>
              <rect x={p.x} y={p.y} width={nodeW} height={nodeH} rx={8} fill="#1a1a19" stroke={n.kind === 'hypothesis' ? '#d95926' : 'rgba(255,255,255,0.25)'} />
              <text x={p.x + nodeW / 2} y={p.y + nodeH / 2 + 4} textAnchor="middle" fontSize={11} fill="#f0efec">
                {n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label}
              </text>
              <title>{n.label}</title>
            </g>
          );
          return n.href ? (
            <Link key={n.id} href={n.href}>
              {box}
            </Link>
          ) : (
            <g key={n.id}>{box}</g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-ink-300">実線: データで確認できる関係。橙の破線: 未検証の因果（原因の候補）。ノードを押すと規則・判断・トレース・実験へ移動します。</p>
    </div>
  );
}
