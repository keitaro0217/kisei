'use client';

import { useRouter } from 'next/navigation';
import { usePortal } from '@/store/portalStore';
import { CalendarExportType } from '@/types';
import { buildCalendarEvents } from '@/services/calendar/calendarEventMapper';
import { buildGoogleCalendarUrl } from '@/services/calendar/googleCalendarUrlService';

const statusConfig: Record<string, { label: string; className: string }> = {
  disconnected: { label: '未連携', className: 'bg-gray-100 text-gray-600' },
  preparing: { label: 'エクスポート準備中', className: 'bg-blue-100 text-blue-700' },
  exported: { label: 'エクスポート完了', className: 'bg-green-100 text-green-700' },
  failed: { label: 'エクスポート失敗', className: 'bg-red-100 text-red-700' },
};

const exportTypeLabels: Record<string, string> = {
  all: 'すべて',
  courses: '授業のみ',
  assignments: '課題のみ',
};

function formatDateTime(date: Date | null): string {
  if (!date) return '未実行';
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

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

export default function CalendarSettingsPage() {
  const router = useRouter();
  const { state, updateCalendarSettings, exportCalendar, disconnectCalendar } = usePortal();
  const { calendarConnectionStatus, calendarLastExported, calendarExportSettings, calendarExportLogs } = state;

  const status = statusConfig[calendarConnectionStatus];
  const isPreparing = calendarConnectionStatus === 'preparing';

  const handleExport = (type: CalendarExportType) => {
    exportCalendar(type);
  };

  const upcomingEvents = buildCalendarEvents(
    {
      courses: state.courses,
      timetableSlots: state.timetableSlots,
      assignments: state.assignments,
      announcements: state.announcements,
    },
    calendarExportSettings
  )
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())
    .slice(0, 5);

  return (
    <div className="px-4 pt-6 pb-4 space-y-6">
      <button onClick={() => router.push('/settings')} className="text-sm text-gray-500">
        ← 戻る
      </button>

      <h1 className="text-xl font-bold text-gray-900">カレンダー連携</h1>

      <section className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-900">連携ステータス</p>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${status.className}`}>
            {status.label}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          最終エクスポート日時: {formatDateTime(calendarLastExported)}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">エクスポート</h2>
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <button
            onClick={() => handleExport('all')}
            disabled={isPreparing}
            className="w-full py-3 rounded-xl text-white text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#003366' }}
          >
            {isPreparing ? 'エクスポート準備中...' : '今すぐカレンダーに追加'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport('courses')}
              disabled={isPreparing}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              授業だけ追加
            </button>
            <button
              onClick={() => handleExport('assignments')}
              disabled={isPreparing}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              課題だけ追加
            </button>
          </div>
          {calendarConnectionStatus === 'exported' && (
            <p className="text-xs text-green-600 font-medium">
              エクスポートが完了しました。ダウンロードされた .ics ファイルをカレンダーアプリで開いてください。
            </p>
          )}
          {calendarConnectionStatus === 'failed' && (
            <p className="text-xs text-red-600 font-medium">
              エクスポートに失敗しました。もう一度お試しください。
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">エクスポート対象</h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">授業時間割</p>
            <Toggle
              checked={calendarExportSettings.includeCourses}
              onChange={() => updateCalendarSettings({ includeCourses: !calendarExportSettings.includeCourses })}
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">課題締切</p>
            <Toggle
              checked={calendarExportSettings.includeAssignments}
              onChange={() =>
                updateCalendarSettings({ includeAssignments: !calendarExportSettings.includeAssignments })
              }
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">試験日程</p>
            <Toggle
              checked={calendarExportSettings.includeExams}
              onChange={() => updateCalendarSettings({ includeExams: !calendarExportSettings.includeExams })}
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">重要なお知らせ</p>
            <Toggle
              checked={calendarExportSettings.includeAnnouncements}
              onChange={() =>
                updateCalendarSettings({ includeAnnouncements: !calendarExportSettings.includeAnnouncements })
              }
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">詳細設定</h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">提出済み課題も含める</p>
            <Toggle
              checked={calendarExportSettings.includeSubmittedAssignments}
              onChange={() =>
                updateCalendarSettings({
                  includeSubmittedAssignments: !calendarExportSettings.includeSubmittedAssignments,
                })
              }
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">土曜授業を含める</p>
            <Toggle
              checked={calendarExportSettings.includeSaturdayClasses}
              onChange={() =>
                updateCalendarSettings({ includeSaturdayClasses: !calendarExportSettings.includeSaturdayClasses })
              }
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">オンライン授業URLを含める</p>
            <Toggle
              checked={calendarExportSettings.includeOnlineClassUrl}
              onChange={() =>
                updateCalendarSettings({ includeOnlineClassUrl: !calendarExportSettings.includeOnlineClassUrl })
              }
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">締切当日に通知する</p>
            <Toggle
              checked={calendarExportSettings.assignmentReminderOnDueDate}
              onChange={() =>
                updateCalendarSettings({
                  assignmentReminderOnDueDate: !calendarExportSettings.assignmentReminderOnDueDate,
                })
              }
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">授業開始何分前に通知するか</p>
            <input
              type="number"
              min={0}
              value={calendarExportSettings.courseReminderMinutes}
              onChange={(e) =>
                updateCalendarSettings({ courseReminderMinutes: Number(e.target.value) || 0 })
              }
              className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-right focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">課題締切何日前に通知するか</p>
            <input
              type="number"
              min={0}
              value={calendarExportSettings.assignmentReminderDays}
              onChange={(e) =>
                updateCalendarSettings({ assignmentReminderDays: Number(e.target.value) || 0 })
              }
              className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-right focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">今後の予定をGoogleカレンダーに追加</h2>
        {upcomingEvents.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            予定はありません
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            {upcomingEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {event.startDateTime.getMonth() + 1}/{event.startDateTime.getDate()}{' '}
                    {event.startDateTime.getHours().toString().padStart(2, '0')}:
                    {event.startDateTime.getMinutes().toString().padStart(2, '0')}
                  </p>
                </div>
                <a
                  href={buildGoogleCalendarUrl(event)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 flex-shrink-0"
                >
                  Googleカレンダーに追加
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">エクスポート履歴</h2>
        {calendarExportLogs.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            履歴はありません
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            {calendarExportLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">
                    {exportTypeLabels[log.exportType]} ・ {log.eventCount}件
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(log.exportedAt)}</p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${
                    log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {log.status === 'success' ? '成功' : '失敗'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        onClick={disconnectCalendar}
        className="w-full py-2.5 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
      >
        連携を解除
      </button>
    </div>
  );
}
