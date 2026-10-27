import Link from 'next/link';
import { Course } from '@/types';

type Props = {
  course: Course;
  period?: number;
};

const formatLabels: Record<string, string> = {
  'in-person': '対面',
  online: 'オンライン',
  hybrid: 'ハイブリッド',
};

export default function CourseCard({ course, period }: Props) {
  return (
    <Link
      href={`/timetable/${course.id}`}
      className="bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 hover:bg-gray-50 transition-colors"
    >
      <div
        className="w-1 self-stretch rounded-full flex-shrink-0"
        style={{ backgroundColor: course.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-gray-900 text-sm leading-tight">{course.name}</h3>
          {period && (
            <span className="text-xs text-gray-500 flex-shrink-0">{period}限</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{course.instructor}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-gray-600">{course.room}</span>
          <span className="text-xs text-gray-400">•</span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: `${course.color}20`, color: course.color }}
          >
            {formatLabels[course.format]}
          </span>
        </div>
      </div>
    </Link>
  );
}
