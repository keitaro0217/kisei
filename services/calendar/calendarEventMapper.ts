import {
  Announcement,
  Assignment,
  CalendarEvent,
  Course,
  CalendarExportSettings,
  TimetableSlot,
} from '@/types';

type PeriodTime = { startHour: number; startMinute: number; endHour: number; endMinute: number };

const periodTimes: Record<number, PeriodTime> = {
  1: { startHour: 9, startMinute: 0, endHour: 10, endMinute: 30 },
  2: { startHour: 10, startMinute: 45, endHour: 12, endMinute: 15 },
  3: { startHour: 13, startMinute: 0, endHour: 14, endMinute: 30 },
  4: { startHour: 14, startMinute: 45, endHour: 16, endMinute: 15 },
  5: { startHour: 16, startMinute: 30, endHour: 18, endMinute: 0 },
  6: { startHour: 18, startMinute: 15, endHour: 19, endMinute: 45 },
};

const WEEKS_AHEAD = 4;

function nextOccurrencesOfWeekday(dayOfWeek: number, baseDate: Date, weeks: number): Date[] {
  const dates: Date[] = [];
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);
  const diff = (dayOfWeek - start.getDay() + 7) % 7;
  const firstOccurrence = new Date(start);
  firstOccurrence.setDate(start.getDate() + diff);
  for (let i = 0; i < weeks; i++) {
    const d = new Date(firstOccurrence);
    d.setDate(firstOccurrence.getDate() + i * 7);
    dates.push(d);
  }
  return dates;
}

function withTime(date: Date, hour: number, minute: number): Date {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const formatLabels: Record<string, string> = {
  'in-person': '対面',
  online: 'オンライン',
  hybrid: 'ハイブリッド',
};

export function mapCoursesToEvents(
  courses: Course[],
  timetableSlots: TimetableSlot[],
  settings: CalendarExportSettings,
  baseDate: Date = new Date()
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const slot of timetableSlots) {
    if (slot.dayOfWeek === 6 && !settings.includeSaturdayClasses) continue;
    const course = courses.find((c) => c.id === slot.courseId);
    if (!course) continue;

    const periodTime = periodTimes[slot.period];
    if (!periodTime) continue;

    const occurrences = nextOccurrencesOfWeekday(slot.dayOfWeek, baseDate, WEEKS_AHEAD);

    occurrences.forEach((occurrenceDate, index) => {
      const startDateTime = withTime(occurrenceDate, periodTime.startHour, periodTime.startMinute);
      const endDateTime = withTime(occurrenceDate, periodTime.endHour, periodTime.endMinute);

      const descriptionParts = [
        `担当: ${course.instructor}`,
        `形式: ${formatLabels[course.format] ?? course.format}`,
      ];
      if (settings.includeOnlineClassUrl && (course.format === 'online' || course.format === 'hybrid')) {
        descriptionParts.push(`LMS: ${course.lmsUrl}`);
      }

      events.push({
        id: `course-${slot.id}-${index}`,
        title: course.name,
        description: descriptionParts.join('\n'),
        startDateTime,
        endDateTime,
        location: `${course.campus} ${course.room}`,
        type: 'course',
        relatedCourseId: course.id,
        url: course.lmsUrl,
        reminderMinutes: settings.courseReminderMinutes,
      });
    });
  }

  return events;
}

export function mapAssignmentsToEvents(
  assignments: Assignment[],
  courses: Course[],
  settings: CalendarExportSettings
): CalendarEvent[] {
  if (!settings.includeAssignments) return [];

  const statusLabels: Record<string, string> = {
    pending: '未提出',
    submitted: '提出済み',
    overdue: '期限切れ',
  };

  return assignments
    .filter((a) => settings.includeSubmittedAssignments || a.status !== 'submitted')
    .map((assignment) => {
      const course = courses.find((c) => c.id === assignment.courseId);
      const startDateTime = new Date(assignment.dueDate);
      const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

      const descriptionParts = [
        `授業: ${course?.name ?? ''}`,
        `状況: ${statusLabels[assignment.status] ?? assignment.status}`,
        `課題URL: ${assignment.assignmentUrl}`,
      ];
      if (assignment.description) descriptionParts.push(assignment.description);

      return {
        id: `assignment-${assignment.id}`,
        title: `【課題締切】${course?.name ?? ''} ${assignment.title}`,
        description: descriptionParts.join('\n'),
        startDateTime,
        endDateTime,
        location: '',
        type: 'assignment',
        relatedAssignmentId: assignment.id,
        relatedCourseId: assignment.courseId,
        url: assignment.assignmentUrl,
        reminderMinutes: settings.assignmentReminderOnDueDate
          ? 0
          : settings.assignmentReminderDays * 24 * 60,
      } satisfies CalendarEvent;
    });
}

export function mapAnnouncementsToEvents(
  announcements: Announcement[],
  courses: Course[],
  settings: CalendarExportSettings
): CalendarEvent[] {
  if (!settings.includeAnnouncements) return [];

  return announcements
    .filter((a) => a.isImportant)
    .map((announcement) => {
      const course = announcement.courseId
        ? courses.find((c) => c.id === announcement.courseId)
        : undefined;
      const startDateTime = new Date(announcement.date);
      const endDateTime = new Date(startDateTime.getTime() + 15 * 60 * 1000);

      return {
        id: `announcement-${announcement.id}`,
        title: announcement.title,
        description: announcement.content,
        startDateTime,
        endDateTime,
        location: '',
        type: 'announcement',
        relatedCourseId: course?.id,
        reminderMinutes: 0,
      } satisfies CalendarEvent;
    });
}

type CalendarEventSourceState = {
  courses: Course[];
  timetableSlots: TimetableSlot[];
  assignments: Assignment[];
  announcements: Announcement[];
};

export function buildCalendarEvents(
  state: CalendarEventSourceState,
  settings: CalendarExportSettings,
  baseDate: Date = new Date()
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  if (settings.includeCourses) {
    events.push(...mapCoursesToEvents(state.courses, state.timetableSlots, settings, baseDate));
  }
  if (settings.includeAssignments) {
    events.push(...mapAssignmentsToEvents(state.assignments, state.courses, settings));
  }
  if (settings.includeAnnouncements) {
    events.push(...mapAnnouncementsToEvents(state.announcements, state.courses, settings));
  }

  return events;
}
