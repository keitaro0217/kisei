'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Kisei Research Lab の UI 部品（ホワイト基調・ネイビー／ブルーのアクセント）。

export function Card({ title, subtitle, actions, children, className = '', id }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,30,61,0.04),0_8px_24px_-12px_rgba(15,30,61,0.10)] ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-[#0b1f44]">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-45';
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
  const variants = {
    primary: 'bg-[#1d4ed8] text-white shadow-sm hover:bg-[#1e40af]',
    secondary: 'border border-slate-200 bg-white text-[#0b1f44] hover:border-slate-300 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
  };
  return <button type="button" className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...p} />;
}

export type Provenance = 'simulation' | 'hypothesis' | 'sample' | 'assumption' | 'real_llm' | 'ground_truth' | 'app_text';
const PROV: Record<Provenance, { label: string; cls: string }> = {
  simulation: { label: 'Simulation Output（決定論的シミュレーションの計算結果）', cls: 'bg-blue-50 text-blue-800 ring-blue-200' },
  hypothesis: { label: '仮説・実験計画（実測結果ではない）', cls: 'bg-violet-50 text-violet-800 ring-violet-200' },
  sample: { label: 'サンプル（固定の例）', cls: 'bg-slate-100 text-slate-700 ring-slate-200' },
  assumption: { label: 'デモ用の設計上の仮定', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  real_llm: { label: 'Real LLM Output', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  ground_truth: { label: 'シミュレーター内の正解（評価器には非公開）', cls: 'bg-teal-50 text-teal-800 ring-teal-200' },
  app_text: { label: 'アプリが生成した説明（LLM の出力ではない）', cls: 'bg-slate-100 text-slate-700 ring-slate-200' },
};
export function ProvenanceBadge({ kind, short = false }: { kind: Provenance; short?: boolean }) {
  const p = PROV[kind];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${p.cls}`}>{short ? p.label.split('（')[0] : p.label}</span>;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'blue' | 'navy' | 'green' | 'amber' | 'rose' | 'violet' }) {
  const t = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    navy: 'bg-[#0b1f44] text-white ring-[#0b1f44]',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  }[tone];
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${t}`}>{children}</span>;
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'note'; title?: ReactNode; children?: ReactNode }) {
  const t = { info: 'border-blue-200 bg-blue-50/60 text-blue-900', warn: 'border-amber-200 bg-amber-50/70 text-amber-900', note: 'border-slate-200 bg-slate-50 text-slate-700' }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-[13px] leading-relaxed ${t}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[#0b1f44]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputCls = 'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-[#1d4ed8]' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0b1f44] sm:text-[28px]">{title}</h1>
        {description && <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const num = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));

/** ブラウザでファイルを保存する（エクスポート） */
export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
