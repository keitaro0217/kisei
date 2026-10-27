'use client';

import { usePortal } from '@/store/portalStore';
import AnnouncementCard from '@/components/AnnouncementCard';

export default function AnnouncementsPage() {
  const { state } = usePortal();
  const { courses, announcements } = state;

  const sorted = [...announcements].sort((a, b) => b.date.getTime() - a.date.getTime());

  const important = sorted.filter((a) => a.isImportant);
  const universityWide = sorted.filter((a) => !a.courseId);
  const courseSpecific = sorted.filter((a) => !!a.courseId);

  return (
    <div className="px-4 pt-6 pb-4 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">お知らせ</h1>

      {important.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
              重要
            </span>
            <h2 className="font-bold text-gray-900">重要なお知らせ</h2>
          </div>
          <div className="space-y-2">
            {important.map((ann) => (
              <AnnouncementCard
                key={ann.id}
                announcement={ann}
                course={ann.courseId ? courses.find((c) => c.id === ann.courseId) : undefined}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-bold text-gray-900 mb-3">大学全体のお知らせ</h2>
        {universityWide.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            お知らせはありません
          </div>
        ) : (
          <div className="space-y-2">
            {universityWide.map((ann) => (
              <AnnouncementCard key={ann.id} announcement={ann} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-bold text-gray-900 mb-3">授業ごとのお知らせ</h2>
        {courseSpecific.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
            お知らせはありません
          </div>
        ) : (
          <div className="space-y-2">
            {courseSpecific.map((ann) => (
              <AnnouncementCard
                key={ann.id}
                announcement={ann}
                course={courses.find((c) => c.id === ann.courseId)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
