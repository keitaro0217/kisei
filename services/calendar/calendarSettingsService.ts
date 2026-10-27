import { CalendarExportSettings } from '@/types';

export const defaultCalendarExportSettings: CalendarExportSettings = {
  includeCourses: true,
  includeAssignments: true,
  includeExams: true,
  includeAnnouncements: false,
  includeSubmittedAssignments: false,
  courseReminderMinutes: 15,
  assignmentReminderDays: 1,
  assignmentReminderOnDueDate: true,
  includeOnlineClassUrl: true,
  includeSaturdayClasses: false,
};

const STORAGE_KEY = 'calendarExportSettings';

export function loadCalendarExportSettings(): CalendarExportSettings {
  if (typeof window === 'undefined') return defaultCalendarExportSettings;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultCalendarExportSettings;
    const parsed = JSON.parse(stored);
    return { ...defaultCalendarExportSettings, ...parsed };
  } catch {
    return defaultCalendarExportSettings;
  }
}

export function saveCalendarExportSettings(settings: CalendarExportSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}
