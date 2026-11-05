'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useDemo } from './DemoStore';
import { Button, Toggle } from './ui';

// サイドバー・ガイド付きモード・共通の ID の表示

export const NAV: { href: string; label: string; jp: string; tag?: string }[] = [
  { href: '/demo/research', label: 'Research Overview', jp: '研究の概要' },
  { href: '/demo/research/rules', label: 'Rule Studio', jp: '条文ミニマルペア', tag: 'A/B' },
  { href: '/demo/research/market', label: 'Market Simulator', jp: '仮想市場', tag: 'LOB' },
  { href: '/demo/research/trace', label: 'Agent Trace', jp: '行動トレース' },
  { href: '/demo/research/experiment', label: 'Experiment Builder', jp: '2×2 要因実験', tag: '2×2' },
  { href: '/demo/research/analysis', label: 'Causal Analysis', jp: '因果分析' },
  { href: '/demo/research/grading', label: 'Dual Grading', jp: 'デュアル・グレーディング' },
  { href: '/demo/research/patch', label: 'Auto-Patch & Verify', jp: '修正と検証', tag: 'HIL' },
  { href: '/demo/research/report', label: 'Research Report', jp: '研究レポート' },
];

export const GUIDE = [
  { href: '/demo/research/rules', title: 'Step 1：規則の違いを理解する', body: '条文Aと条文Bは「新規に」の3文字だけが違います。この違いで、既に売り持ちの参加者の「積み増し」が規則の対象になるかが変わります。' },
  { href: '/demo/research/experiment', title: 'Step 2：実験条件を選ぶ', body: '文言（A / B）と規制趣旨の説明（なし C1 / あり C2）の 2×2 に、規則なしの統制条件を加えた5条件を比べます。条件は開始時に固定されます。' },
  { href: '/demo/research/market', title: 'Step 3：AI エージェントの行動を観察する', body: 'Start で合成市場を動かします。下落局面で、エージェントが直前の約定価格の下で売りを積み増すか（文言A）を、注文板と価格の図で確認できます。' },
  { href: '/demo/research/grading', title: 'Step 4：形式適合と趣旨逸脱の違いを確認する', body: 'Build（取引ログの決定論的判定）と Judge（説明の評価）を別々に見ます。形式上は適合していても、趣旨からは逸脱候補になる注文があります。' },
  { href: '/demo/research/analysis', title: 'Step 5：4条件を比較する', body: '実験を実行すると、条件ごとの形式違反率・趣旨逸脱候補率・誤拒否率と、文言・趣旨説明の効果（95% 区間）が表示されます。' },
  { href: '/demo/research/patch', title: 'Step 6：修正案を試す', body: '修正案をサンドボックスに適用し、同じシードで再実験して前後を比べます。正常な取引への副作用（誤拒否）も測ります。' },
  { href: '/demo/research/report', title: 'Step 7：研究結果を確認する', body: '実行した内容をレポートにまとめ、CSV / JSON で出力できます。デモの結果はシミュレーションの出力であり、研究の実測結果ではありません。' },
];

export default function Shell({ children }: { children: ReactNode }) {
  const d = useDemo();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const g = d.guideStep;
  const go = (i: number | null) => {
    d.update({ guideStep: i });
    if (i !== null) router.push(GUIDE[i].href);
  };
  return (
    <div className="kisei-demo min-h-screen bg-[#f7f8fb] text-slate-900">
      <div className="flex">
        <aside className={`print:hidden fixed inset-y-0 left-0 z-30 w-[288px] border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-full flex-col">
            <Link href="/demo/research" className="block border-b border-slate-200 px-5 py-6" onClick={() => setOpen(false)}>
              <span className="block border-l-[3px] border-[#1e2a4a] pl-3">
                <span className="block text-[18px] font-semibold tracking-tight text-[#1e2a4a]">Kisei Research Lab</span>
                <span className="mt-0.5 block text-[12px] text-slate-500">Regulatory Intent &amp; Agent Behavior</span>
              </span>
            </Link>
            <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="デモのページ">
              <p className="mb-2 px-3 text-[11px] font-semibold tracking-[0.12em] text-slate-500">
                PIPELINE <span className="font-normal tracking-normal text-slate-400">Research Workflow</span>
              </p>
              {NAV.map((n, i) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    title={n.jp}
                    onClick={() => setOpen(false)}
                    className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition ${active ? 'bg-indigo-50 font-medium text-[#4338ca]' : 'text-[#1e2a4a] hover:bg-slate-50'}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${active ? 'bg-[#4f46e5] text-white' : 'bg-slate-100 text-slate-500'}`}>{i === 0 ? '◎' : i}</span>
                    <span className="min-w-0 flex-1 truncate">{n.label}</span>
                    {n.tag && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${n.tag === 'HIL' ? 'bg-[#4f46e5] text-white' : 'bg-emerald-50 text-emerald-700'}`}>{n.tag}</span>}
                  </Link>
                );
              })}
            </nav>
            <div className="space-y-3 border-t border-slate-100 px-5 py-4">
              <Toggle checked={d.advanced} onChange={(v) => d.update({ advanced: v })} label="Advanced Mode" />
              <p className="text-[11px] leading-relaxed text-slate-400">合成市場・合成規則のみ。実在の市場・法令には接続しません。状態はこのブラウザにのみ保存されます。</p>
            </div>
          </div>
        </aside>
        {open && <button type="button" aria-label="メニューを閉じる" className="fixed inset-0 z-20 bg-slate-900/20 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="min-w-0 flex-1">
          <header className="print:hidden sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-[#f7f8fb]/90 px-4 py-3 backdrop-blur sm:px-10">
            <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-sm lg:hidden" onClick={() => setOpen(true)} aria-label="メニュー">
              ☰
            </button>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>
                Run ID <code className="rounded bg-slate-100 px-1 text-slate-700">{d.runId}</code>
              </span>
              <span>
                Scenario <code className="rounded bg-slate-100 px-1 text-slate-700">{d.scenarioId}</code>
              </span>
              <span>
                Rule Version <code className="rounded bg-slate-100 px-1 text-slate-700">{d.ruleVersion}</code>
              </span>
              <span>
                条件 <code className="rounded bg-slate-100 px-1 text-slate-700">{d.condition}</code>
              </span>
            </div>
            <div className="ml-auto flex gap-2">
              {g === null ? (
                <Button variant="primary" size="sm" onClick={() => go(0)}>
                  研究デモを開始
                </Button>
              ) : (
                <Button size="sm" onClick={() => go(null)}>
                  ガイドを終了
                </Button>
              )}
            </div>
          </header>
          {g !== null && (
            <div className="print:hidden border-b border-blue-100 bg-gradient-to-r from-[#1e2a4a] to-[#4f46e5] px-4 py-3 text-white sm:px-8">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
                <div className="flex gap-1" aria-hidden>
                  {GUIDE.map((_, i) => (
                    <span key={i} className={`h-1.5 w-6 rounded-full ${i <= g ? 'bg-white' : 'bg-white/30'}`} />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{GUIDE[g].title}</p>
                  <p className="text-xs text-blue-100">{GUIDE[g].body}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" disabled={g === 0} onClick={() => go(g - 1)}>
                    前へ
                  </Button>
                  {g < GUIDE.length - 1 ? (
                    <Button size="sm" className="bg-white text-[#1e2a4a]" onClick={() => go(g + 1)}>
                      次へ
                    </Button>
                  ) : (
                    <Button size="sm" className="bg-white text-[#1e2a4a]" onClick={() => go(null)}>
                      完了
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          <main key={pathname} className="kd-page max-w-[1640px] px-4 pb-12 pt-2 sm:px-10">{d.hydrated ? children : <p className="text-sm text-slate-500">読み込み中…</p>}</main>
        </div>
      </div>
    </div>
  );
}
