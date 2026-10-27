'use client';

import Link from 'next/link';
import { apiKeyRequired } from '@/lib/research/labels';
import type { ProviderDTO, ResearchRole, RoleAssignment } from '@/lib/research/types';

/** 接続情報が未設定のときに表示する設定案内 */
export function setupSteps(providers: ProviderDTO[], roles: Record<ResearchRole, RoleAssignment>) {
  const trading = roles.trading_agent;
  const tradingProvider = providers.find((p) => p.id === trading.providerId);
  return [
    { done: providers.length > 0, label: 'APIプロバイダーを追加する', href: '/research/settings/api' },
    { done: providers.some((p) => p.hasApiKey || !apiKeyRequired[p.type]), label: 'APIキーを登録する（サーバーで暗号化して保存）', href: '/research/settings/api' },
    { done: providers.some((p) => p.connection.status === 'connected'), label: '接続テストを実行し「接続済み」にする', href: '/research/settings/api' },
    { done: Boolean(trading.providerId && trading.model), label: '取引エージェントにモデルを割り当てる', href: '/research/settings/models' },
    { done: tradingProvider?.connection.status === 'connected', label: '取引エージェントのプロバイダーが接続済みであることを確認する', href: '/research/settings/api' },
  ];
}

export default function SetupGuide({ providers, roles, compact }: { providers: ProviderDTO[]; roles: Record<ResearchRole, RoleAssignment>; compact?: boolean }) {
  const steps = setupSteps(providers, roles);
  if (steps.every((s) => s.done)) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 shadow-sm">
      <p className="text-sm font-semibold text-amber-200">AI接続の設定が完了していません</p>
      {!compact && <p className="mt-1 text-xs text-amber-200">研究実験を実行するには、以下の手順で接続情報を設定してください。ソースコードの編集は不要です。</p>}
      <ol className="mt-3 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs ${s.done ? 'bg-emerald-600 text-white' : 'bg-ink-900 text-amber-200 ring-1 ring-amber-400/40'}`}>
              {s.done ? '✓' : i + 1}
            </span>
            {s.done ? (
              <span className="text-ink-200 line-through">{s.label}</span>
            ) : (
              <Link href={s.href} className="text-amber-200 underline underline-offset-2 hover:text-amber-200">
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
