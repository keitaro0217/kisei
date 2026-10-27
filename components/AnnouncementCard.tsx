import { Announcement, Course } from '@/types';

type Props = {
  announcement: Announcement;
  course?: Course;
};

function formatDate(date: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff < 7) return `${diff}日前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function AnnouncementCard({ announcement, course }: Props) {
  return (
    <div
      className="bg-white rounded-xl shadow-sm p-4"
      style={
        announcement.isImportant
          ? { borderLeft: '4px solid #F59E0B', backgroundColor: '#FFFBEB' }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {announcement.isImportant && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
              重要
            </span>
          )}
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              announcement.source === 'university-portal'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
            }`}
          >
            {announcement.source === 'university-portal' ? 'ポータル' : 'LMS'}
          </span>
          {course && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${course.color}20`, color: course.color }}
            >
              {course.name}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(announcement.date)}</span>
      </div>
      <h3 className="font-bold text-gray-900 text-sm leading-tight mb-1">{announcement.title}</h3>
      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{announcement.content}</p>
    </div>
  );
}
