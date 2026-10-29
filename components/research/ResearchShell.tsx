'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import type { BasicSettings } from '@/lib/research/types';

const SettingsContext = createContext<BasicSettings | null>(null);
export const useBasicSettings = () => useContext(SettingsContext);

// アイコン（Heroicons outline 相当のパス）
const icons = {
  impact: 'M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941',
  trace: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z',
  evaluation: 'M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z',
  failure: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  patch: 'M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085',
  monitor: 'M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  studies: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z',
  rules: 'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z',
  prompts: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
  dashboard: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  experiments: 'M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5',
  simulation: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  settings: 'M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
};

function Icon({ path, className = 'h-5 w-5' }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={path} />
    </svg>
  );
}

type NavItem = { href: string; label: string; icon: string; exact?: boolean; group: string };

// メニュー: Overview / Research / Observability / Evaluation / Risk Intelligence / Improvement / Monitoring / Settings
const nav: NavItem[] = [
  { group: '概要', href: '/research', label: 'ダッシュボード', icon: icons.dashboard, exact: true },
  { group: '概要', href: '/research/poc', label: 'Business Impact', icon: icons.impact },
  { group: '研究', href: '/research/studies', label: '研究プロジェクト', icon: icons.studies },
  { group: '研究', href: '/research/compare', label: '研究の比較', icon: icons.simulation },
  { group: '研究', href: '/research/rules', label: '規則・条文', icon: icons.rules },
  { group: '研究', href: '/research/prompts', label: 'プロンプト', icon: icons.prompts },
  { group: '研究', href: '/research/experiments', label: '研究実験（単一条件）', icon: icons.experiments },
  { group: '研究', href: '/research/simulation', label: 'シミュレーション', icon: icons.simulation },
  { group: '観測', href: '/research/traces', label: '実行トレース', icon: icons.trace },
  { group: '評価', href: '/research/evaluation', label: '多層評価・人の評価', icon: icons.evaluation },
  { group: 'リスク分析', href: '/research/failures', label: 'Failure Library', icon: icons.failure },
  { group: 'リスク分析', href: '/research/test-cases', label: '回帰テストのデータセット', icon: icons.evaluation },
  { group: '改善', href: '/research/patches', label: 'Auto-Patch・回帰テスト', icon: icons.patch },
  { group: '監視', href: '/research/monitoring', label: '監視（試験版）', icon: icons.monitor },
  { group: '設定', href: '/research/settings', label: '設定', icon: icons.settings },
];

export const settingsNav = [
  { href: '/research/settings/general', label: '基本設定' },
  { href: '/research/settings/api', label: 'API連携' },
  { href: '/research/settings/models', label: 'モデル割り当て' },
  { href: '/research/settings/execution', label: '実行設定' },
  { href: '/research/settings/costs', label: '費用管理' },
  { href: '/research/settings/security', label: 'セキュリティ' },
];

function LogoutButton({ className }: { className: string }) {
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    window.location.assign('/login');
  };
  return (
    <button type="button" onClick={logout} className={className}>
      ログアウト
    </button>
  );
}

function useActive() {
  const pathname = usePathname();
  return {
    pathname,
    isActive: (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)),
  };
}

export default function ResearchShell({ basic, principal, children }: { basic: BasicSettings; principal: string; children: ReactNode }) {
  const { pathname, isActive } = useActive();
  const current = settingsNav.find((s) => pathname === s.href) ?? nav.find((n) => isActive(n.href, n.exact));

  return (
    <SettingsContext.Provider value={basic}>
      <div className="research-root md:flex">
        {/* デスクトップ: 黒の固定サイドバー */}
        <aside className="rc-sidebar sticky top-0 hidden h-screen w-64 flex-shrink-0 flex-col text-ink-100 md:flex">
          <Link href="/research" className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rc-primary rounded-lg text-sm font-bold">R</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-snug text-white [overflow-wrap:anywhere]">{basic.appDisplayName}</span>
              <span className="block text-[11px] text-ink-300">Research Console</span>
            </span>
          </Link>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{nav[0].group}</p>
            {nav.map((item, i) => {
              const active = isActive(item.href, item.exact);
              const groupStart = i === 0 || nav[i - 1].group !== item.group;
              return (
                <div key={item.href}>
                  {groupStart && i > 0 && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{item.group}</p>}
                  <Link
                    href={item.href}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      active ? 'bg-white/10 font-semibold text-white' : 'text-ink-200 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-white" aria-hidden />}
                    <Icon path={item.icon} className={`h-5 w-5 ${active ? 'text-white' : 'text-ink-300 group-hover:text-white'}`} />
                    {item.label}
                  </Link>
                  {item.href === '/research/settings' && isActive(item.href) && (
                    <div className="mb-2 ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                      {settingsNav.map((s) => (
                        <Link
                          key={s.href}
                          href={s.href}
                          className={`block rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                            pathname === s.href ? 'bg-white/10 font-semibold text-white' : 'text-ink-300 hover:text-white'
                          }`}
                        >
                          {s.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="border-t border-white/10 px-5 py-4">
            <p className="text-[11px] text-ink-400">ログイン中</p>
            <p className="mt-0.5 flex items-center gap-2 truncate text-sm text-white">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              {principal}
            </p>
            <LogoutButton className="mt-3 w-full rounded-md px-3 py-1.5 text-xs text-ink-200 ring-1 ring-inset ring-white/15 hover:bg-white/5 hover:text-white" />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* モバイル: 黒のヘッダーと横スクロールのメニュー */}
          <header className="rc-sidebar sticky top-0 z-30 text-white md:hidden">
            <div className="flex h-14 items-center gap-2.5 px-4">
              <span className="flex h-8 w-8 items-center justify-center rc-primary rounded-lg text-sm font-bold">R</span>
              <span className="truncate text-sm font-semibold">{basic.appDisplayName}</span>
              <LogoutButton className="ml-auto whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-ink-200 ring-1 ring-inset ring-white/15" />
            </div>
            <nav className="flex gap-1 overflow-x-auto px-2">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                    isActive(item.href, item.exact) ? 'border-white font-semibold text-white' : 'border-transparent text-ink-200'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>

          {/* デスクトップ: 現在位置を示す白いトップバー */}
          <div className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-white/10 bg-ink-950/40 px-8 backdrop-blur-xl md:flex">
            <p className="text-sm text-ink-300">
              {basic.appDisplayName}
              {current && (
                <>
                  <span className="mx-2 text-ink-500">/</span>
                  <span className="font-semibold text-white">{current.label}</span>
                </>
              )}
            </p>
            <span className="flex items-center gap-2 rounded-full bg-ink-800 px-3 py-1 text-xs text-ink-100 ring-1 ring-ink-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              {principal}
            </span>
          </div>

          <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </SettingsContext.Provider>
  );
}

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-white/10 md:hidden">
      {settingsNav.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${pathname === s.href ? 'border-white font-semibold text-white' : 'border-transparent text-ink-200'}`}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
