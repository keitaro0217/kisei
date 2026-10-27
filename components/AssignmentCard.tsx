import { Assignment, Course } from '@/types';
import { buildGoogleCalendarUrl } from '@/services/calendar/googleCalendarUrlService';

type Props = {
  assignment: Assignment;
  course?: Course;
};

const statusConfig = {
  pending: { label: '未提出', className: 'bg-yellow-100 text-yellow-800' },
  submitted: { label: '提出済み', className: 'bg-green-100 text-green-800' },
  overdue: { label: '期限切れ', className: 'bg-red-100 text-red-800' },
};

function formatDueDate(date: Date): string {
  const now = new Date();
  const diff = Math.ceil((date.getTime() - now.getTime()) / 86400000);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
  if (diff < 0) return `${dateStr} (${Math.abs(diff)}日超過)`;
  if (diff === 0) return `${dateStr} (本日)`;
  if (diff === 1) return `${dateStr} (明日)`;
  return `${dateStr} (あと${diff}日)`;
}

export default function AssignmentCard({ assignment, course }: Props) {
  const now = new Date();
  const daysUntilDue = Math.ceil((assignment.dueDate.getTime() - now.getTime()) / 86400000);
  const isUrgent = assignment.status === 'pending' && daysUntilDue <= 3 && daysUntilDue >= 0;
  const isHighlighted = isUrgent || assignment.status === 'overdue';
  const config = statusConfig[assignment.status];

  const calendarUrl = buildGoogleCalendarUrl({
    id: `assignment-${assignment.id}`,
    title: `【課題締切】${course?.name ?? ''} ${assignment.title}`,
    description: `課題URL: ${assignment.assignmentUrl}`,
    startDateTime: assignment.dueDate,
    endDateTime: new Date(assignment.dueDate.getTime() + 30 * 60 * 1000),
    location: '',
    type: 'assignment',
    relatedAssignmentId: assignment.id,
    relatedCourseId: assignment.courseId,
    url: assignment.assignmentUrl,
    reminderMinutes: 60,
  });

  return (
    <div
      className="bg-white rounded-xl shadow-sm p-4"
      style={
        isHighlighted
          ? { borderLeft: '4px solid #EF4444', backgroundColor: '#FEF2F2' }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {course && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                style={{ backgroundColor: `${course.color}20`, color: course.color }}
              >
                {course.name}
              </span>
            )}
            {isUrgent && (
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            )}
          </div>
          <h3 className="font-bold text-gray-900 text-sm leading-tight">{assignment.title}</h3>
          <p className="text-xs text-gray-500 mt-1">締切: {formatDueDate(assignment.dueDate)}</p>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${config.className}`}>
          {config.label}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <a
          href={assignment.assignmentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          開く ↗
        </a>
        <a
          href={calendarUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          締切をカレンダーに追加 ↗
        </a>
      </div>
    </div>
  );
}
