'use client';

import { usePortal } from '@/store/portalStore';
import { universities } from '@/data/dummyData';
import CourseCard from '@/components/CourseCard';
import AssignmentCard from '@/components/AssignmentCard';
import AnnouncementCard from '@/components/AnnouncementCard';

export default function HomePage() {
  const { state, sync, exportCalendar } = usePortal();
  const { courses, timetableSlots, assignments, announcements, syncStatus, lastSynced } = state;
  const isExportingCalendar = state.calendarConnectionStatus === 'preparing';

  const university = universities.find((u) => u.id === state.selectedUniversityId);
  const themeColor = university?.themeColor ?? '#003366';

  const today = new Date();
  const todayDow = today.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  const todaySlots = timetableSlots
    .filter((s) => s.dayOfWeek === todayDow)
    .sort((a, b) => a.period - b.period);

  const todayCourses = todaySlots.map((slot) => ({
    slot,
    course: courses.find((c) => c.id === slot.courseId),
  })).filter((x) => x.course);

  const now = new Date();
  const urgentAssignments = assignments
    .filter((a) => {
      if (a.status !== 'pending') return false;
      const diff = Math.ceil((a.dueDate.getTime() - now.getTime()) / 86400000);
      return diff >= 0 && diff <= 3;
    })
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const pendingCount = assignments.filter((a) => a.status === 'pending').length;

  const importantAnnouncements = announcements
    .filter((a) => a.isImportant)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 3);

  const formatSyncTime = (date: Date | null) => {
    if (!date) return '未同期';
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-6">
      <div
        className="rounded-2xl p-4 text-white"
        style={{ backgroundColor: themeColor }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80 mb-1">{university?.name}</p>
            <p className="font-bold text-base">ポータルと連携済み ✓</p>
            <p className="text-xs opacity-70 mt-1">
              最終同期: {formatSyncTime(lastSynced)}
            </p>
          </div>
          <button
            onClick={sync}
            disabled={syncStatus.isSyncing}
            className="bg-white/20 hover:bg-white/30 disabled:opacity-50 transition-colors px-3 py-2 rounded-xl text-xs font-medium"
          >
            {syncStatus.isSyncing ? '同期中...' : '今すぐ同期'}
          </button>
        </div>
        <button
          onClick={() => exportCalendar('all')}
          disabled={isExportingCalendar}
          className="mt-3 w-full bg-white/20 hover:bg-white/30 disabled:opacity-50 transition-colors px-3 py-2 rounded-xl text-xs font-medium"
        >
          {isExportingCalendar ? 'カレンダーに追加中...' : 'カレンダーに追加'}
        </button>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-900">今日の授業</h2>
          <span className="text-sm text-gray-500">{todayCourses.length}コマ</span>
        </div>
        {todayCourses.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            本日の授業はありません
          </div>
        ) : (
          <div className="space-y-2">
            {todayCourses.map(({ slot, course }) => (
              <CourseCard key={slot.id} course={course!} period={slot.period} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-900">未提出の課題</h2>
          <span
            className="text-xs font-bold px-2 py-1 rounded-full text-white"
            style={{ backgroundColor: pendingCount > 0 ? '#EF4444' : '#9CA3AF' }}
          >
            {pendingCount}件
          </span>
        </div>
        {urgentAssignments.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            期限が近い課題はありません
          </div>
        ) : (
          <div className="space-y-2">
            {urgentAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                course={courses.find((c) => c.id === assignment.courseId)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-900">重要なお知らせ</h2>
        </div>
        <div className="space-y-2">
          {importantAnnouncements.map((ann) => (
            <AnnouncementCard
              key={ann.id}
              announcement={ann}
              course={ann.courseId ? courses.find((c) => c.id === ann.courseId) : undefined}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
