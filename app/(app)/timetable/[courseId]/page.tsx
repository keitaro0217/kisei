'use client';

import { useParams, useRouter } from 'next/navigation';
import { usePortal } from '@/store/portalStore';
import AssignmentCard from '@/components/AssignmentCard';
import AnnouncementCard from '@/components/AnnouncementCard';
import { buildGoogleCalendarUrl } from '@/services/calendar/googleCalendarUrlService';
import { mapCoursesToEvents } from '@/services/calendar/calendarEventMapper';
import { defaultCalendarExportSettings } from '@/services/calendar/calendarSettingsService';

const formatLabels: Record<string, string> = {
  'in-person': '対面',
  online: 'オンライン',
  hybrid: 'ハイブリッド',
};

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const router = useRouter();
  const { state } = usePortal();
  const { courses, assignments, announcements, timetableSlots } = state;

  const course = courses.find((c) => c.id === params.courseId);

  const courseSlots = timetableSlots.filter((s) => s.courseId === params.courseId);
  const courseCalendarEvent = course
    ? mapCoursesToEvents([course], courseSlots, defaultCalendarExportSettings)[0]
    : undefined;

  const relatedAssignments = assignments
    .filter((a) => a.courseId === params.courseId)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const relatedAnnouncements = announcements
    .filter((a) => a.courseId === params.courseId)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (!course) {
    return (
      <div className="px-4 pt-6 pb-4">
        <button onClick={() => router.back()} className="text-sm text-gray-500 mb-4">
          ← 戻る
        </button>
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400 text-sm">
          授業が見つかりませんでした
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4 space-y-6">
      <button onClick={() => router.back()} className="text-sm text-gray-500">
        ← 戻る
      </button>

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-start gap-3">
          <div
            className="w-1.5 self-stretch rounded-full flex-shrink-0"
            style={{ backgroundColor: course.color }}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 leading-tight">{course.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{course.instructor}</p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                {course.room}
              </span>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                {course.campus}
              </span>
              <span
                className="text-xs px-2 py-1 rounded-full font-medium"
                style={{ backgroundColor: `${course.color}20`, color: course.color }}
              >
                {formatLabels[course.format]}
              </span>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                {course.credits}単位
              </span>
            </div>
          </div>
        </div>
        <a
          href={course.lmsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block w-full py-3 rounded-xl text-white text-sm font-bold text-center transition-opacity hover:opacity-90"
          style={{ backgroundColor: course.color }}
        >
          LMSで開く
        </a>
        {courseCalendarEvent && (
          <a
            href={buildGoogleCalendarUrl(courseCalendarEvent)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block w-full py-3 rounded-xl text-sm font-bold text-center border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            この授業をカレンダーに追加
          </a>
        )}
      </div>

      <section>
        <h2 className="font-bold text-gray-900 mb-3">課題</h2>
        {relatedAssignments.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            課題はありません
          </div>
        ) : (
          <div className="space-y-2">
            {relatedAssignments.map((assignment) => (
              <AssignmentCard key={assignment.id} assignment={assignment} course={course} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-bold text-gray-900 mb-3">お知らせ</h2>
        {relatedAnnouncements.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            お知らせはありません
          </div>
        ) : (
          <div className="space-y-2">
            {relatedAnnouncements.map((ann) => (
              <AnnouncementCard key={ann.id} announcement={ann} course={course} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
