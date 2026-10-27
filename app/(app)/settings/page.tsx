'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePortal } from '@/store/portalStore';
import ConnectionCard from '@/components/ConnectionCard';

const calendarStatusConfig: Record<string, { label: string; className: string }> = {
  disconnected: { label: '未連携', className: 'bg-gray-100 text-gray-600' },
  preparing: { label: '準備中', className: 'bg-blue-100 text-blue-700' },
  exported: { label: '連携済み', className: 'bg-green-100 text-green-700' },
  failed: { label: '失敗', className: 'bg-red-100 text-red-700' },
};

type ToggleKey = 'assignmentReminders' | 'importantAnnouncements' | 'syncComplete';

const toggleLabels: { key: ToggleKey; label: string; description: string }[] = [
  { key: 'assignmentReminders', label: '課題締切リマインド', description: '締切が近づいた課題を通知します' },
  { key: 'importantAnnouncements', label: '重要なお知らせ通知', description: '重要なお知らせをすぐに通知します' },
  { key: 'syncComplete', label: '同期完了通知', description: 'ポータル同期が完了したら通知します' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ backgroundColor: checked ? '#22C55E' : '#D1D5DB' }}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { state, selectUniversity, universities, sync } = usePortal();
  const calendarStatus = calendarStatusConfig[state.calendarConnectionStatus];
  const themeColor =
    universities.find((u) => u.id === state.selectedUniversityId)?.themeColor ?? '#003366';

  const [notifications, setNotifications] = useState<Record<ToggleKey, boolean>>({
    assignmentReminders: true,
    importantAnnouncements: true,
    syncComplete: false,
  });

  const toggleNotification = (key: ToggleKey) =>
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));

  const formatSyncTime = (date: Date | null) => {
    if (!date) return '未同期';
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">設定</h1>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">大学を選択</h2>
        <div className="space-y-2">
          {universities.map((uni) => {
            const isSelected = state.selectedUniversityId === uni.id;
            const isComingSoon = uni.supportStatus === 'coming-soon';
            return (
              <button
                key={uni.id}
                onClick={() => !isComingSoon && selectUniversity(uni.id)}
                disabled={isComingSoon}
                className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 transition-all text-left disabled:opacity-60"
                style={isSelected ? { outline: `2px solid ${uni.themeColor}`, outlineOffset: '0px' } : {}}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: uni.themeColor }}
                >
                  {uni.logoInitials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-900 text-sm">{uni.name}</p>
                    {isComingSoon && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                        近日対応
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{uni.portalName} / {uni.lmsName}</p>
                </div>
                {isSelected && (
                  <svg className="w-5 h-5 flex-shrink-0" style={{ color: uni.themeColor }} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">ポータル連携</h2>
        <ConnectionCard />
        {state.connectionStatus === 'connected' && (
          <button
            onClick={sync}
            disabled={state.syncStatus.isSyncing}
            className="mt-2 w-full py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: themeColor }}
          >
            {state.syncStatus.isSyncing ? '同期中...' : '今すぐ同期'}
          </button>
        )}
        <p className="text-xs text-gray-400 mt-2 px-1">
          最終同期: {formatSyncTime(state.lastSynced)}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">カレンダー連携</h2>
        <button
          onClick={() => router.push('/settings/calendar')}
          className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center justify-between gap-3 text-left"
        >
          <div>
            <p className="text-sm font-medium text-gray-900">授業・課題をカレンダーに追加</p>
            <p className="text-xs text-gray-500 mt-0.5">.ics エクスポートやGoogleカレンダー連携を設定できます</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${calendarStatus.className}`}>
            {calendarStatus.label}
          </span>
        </button>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">通知設定</h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {toggleLabels.map((item) => (
            <div key={item.key} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
              </div>
              <Toggle
                checked={notifications[item.key]}
                onChange={() => toggleNotification(item.key)}
              />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">アプリについて</h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-700">バージョン</span>
            <span className="text-sm text-gray-400">1.0.0</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-700">開発者</span>
            <span className="text-sm text-gray-400">UniPortal</span>
          </div>
        </div>
      </section>
    </div>
  );
}
