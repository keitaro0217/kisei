export type University = {
  id: string;
  name: string;
  shortName: string;
  portalName: string;
  lmsName: string;
  themeColor: string;
  logoInitials: string;
  loginUrl: string;
  supportStatus: 'supported' | 'coming-soon';
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export type SyncErrorType = null | 'auth-expired' | 'network' | 'unknown';

export type PortalConnection = {
  userId: string;
  universityId: string;
  status: ConnectionStatus;
  lastSynced: Date | null;
  syncError: SyncErrorType;
  isSyncing: boolean;
};

export type Course = {
  id: string;
  name: string;
  instructor: string;
  room: string;
  campus: string;
  format: 'in-person' | 'online' | 'hybrid';
  color: string;
  credits: number;
  lmsUrl: string;
};

export type TimetableSlot = {
  id: string;
  courseId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  period: 1 | 2 | 3 | 4 | 5 | 6;
};

export type AssignmentStatus = 'pending' | 'submitted' | 'overdue';

export type AssignmentPriority = 'low' | 'normal' | 'high';

export type Assignment = {
  id: string;
  courseId: string;
  title: string;
  dueDate: Date;
  status: AssignmentStatus;
  description?: string;
  assignmentUrl: string;
  priority: AssignmentPriority;
};

export type AnnouncementSource = 'university-portal' | 'lms';

export type Announcement = {
  id: string;
  courseId?: string;
  title: string;
  content: string;
  date: Date;
  isImportant: boolean;
  source: AnnouncementSource;
};

export type SyncResult = 'success' | 'partial' | 'failed';

export type SyncLog = {
  id: string;
  timestamp: Date;
  result: SyncResult;
  coursesFetched: number;
  assignmentsFetched: number;
  announcementsFetched: number;
  errorMessage?: string;
};

export type SyncStatus = {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  message: string;
};

export type CalendarEventType = 'course' | 'assignment' | 'exam' | 'announcement';

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startDateTime: Date;
  endDateTime: Date;
  location: string;
  type: CalendarEventType;
  relatedCourseId?: string;
  relatedAssignmentId?: string;
  url?: string;
  reminderMinutes: number;
};

export type CalendarConnectionStatus = 'disconnected' | 'preparing' | 'exported' | 'failed';

export type CalendarExportSettings = {
  includeCourses: boolean;
  includeAssignments: boolean;
  includeExams: boolean;
  includeAnnouncements: boolean;
  includeSubmittedAssignments: boolean;
  courseReminderMinutes: number;
  assignmentReminderDays: number;
  assignmentReminderOnDueDate: boolean;
  includeOnlineClassUrl: boolean;
  includeSaturdayClasses: boolean;
};

export type CalendarExportType = 'courses' | 'assignments' | 'all';
export type CalendarExportStatus = 'success' | 'failed';

export type CalendarExportLog = {
  id: string;
  exportedAt: Date;
  exportType: CalendarExportType;
  eventCount: number;
  status: CalendarExportStatus;
  errorMessage?: string;
};
