'use client';

import React, { createContext, useContext, useEffect, useReducer } from 'react';
import {
  ConnectionStatus,
  SyncStatus,
  SyncLog,
  CalendarConnectionStatus,
  CalendarExportSettings,
  CalendarExportLog,
  CalendarExportType,
} from '@/types';
import {
  universities,
  courses,
  timetableSlots,
  assignments,
  announcements,
  dummySyncLogs,
  dummyCalendarExportLogs,
} from '@/data/dummyData';
import type { University, Course, TimetableSlot, Assignment, Announcement } from '@/types';
import { defaultCalendarExportSettings } from '@/services/calendar/calendarSettingsService';
import { buildCalendarEvents } from '@/services/calendar/calendarEventMapper';
import { generateICS, downloadICS } from '@/services/calendar/icsExportService';

type State = {
  selectedUniversityId: string;
  connectionStatus: ConnectionStatus;
  lastSynced: Date | null;
  courses: Course[];
  timetableSlots: TimetableSlot[];
  assignments: Assignment[];
  announcements: Announcement[];
  syncStatus: SyncStatus;
  syncLogs: SyncLog[];
  calendarConnectionStatus: CalendarConnectionStatus;
  calendarLastExported: Date | null;
  calendarExportSettings: CalendarExportSettings;
  calendarExportLogs: CalendarExportLog[];
};

type Action =
  | { type: 'SELECT_UNIVERSITY'; universityId: string }
  | { type: 'START_CONNECTION' }
  | { type: 'COMPLETE_CONNECTION' }
  | { type: 'RESET_CONNECTION' }
  | { type: 'START_SYNC' }
  | { type: 'COMPLETE_SYNC' }
  | { type: 'UPDATE_CALENDAR_SETTINGS'; payload: Partial<CalendarExportSettings> }
  | { type: 'START_CALENDAR_EXPORT' }
  | { type: 'COMPLETE_CALENDAR_EXPORT'; payload: { eventCount: number; exportType: CalendarExportType } }
  | { type: 'FAIL_CALENDAR_EXPORT'; payload: { errorMessage: string; exportType: CalendarExportType } }
  | { type: 'DISCONNECT_CALENDAR' }
  | { type: 'HYDRATE'; payload: Partial<State> };

const initialState: State = {
  selectedUniversityId: 'keio',
  connectionStatus: 'connected',
  lastSynced: new Date(Date.now() - 3600000),
  courses,
  timetableSlots,
  assignments,
  announcements,
  syncStatus: {
    isSyncing: false,
    lastSyncTime: new Date(Date.now() - 3600000),
    message: '同期完了',
  },
  syncLogs: dummySyncLogs,
  calendarConnectionStatus: 'disconnected',
  calendarLastExported: null,
  calendarExportSettings: defaultCalendarExportSettings,
  calendarExportLogs: dummyCalendarExportLogs,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SELECT_UNIVERSITY':
      return { ...state, selectedUniversityId: action.universityId };
    case 'START_CONNECTION':
      return {
        ...state,
        connectionStatus: 'connecting',
        syncStatus: { ...state.syncStatus, isSyncing: true, message: 'ログイン中...' },
      };
    case 'COMPLETE_CONNECTION': {
      const now = new Date();
      return {
        ...state,
        connectionStatus: 'connected',
        lastSynced: now,
        syncStatus: { isSyncing: false, lastSyncTime: now, message: '同期完了' },
      };
    }
    case 'RESET_CONNECTION':
      return {
        ...state,
        connectionStatus: 'disconnected',
        lastSynced: null,
        syncStatus: { isSyncing: false, lastSyncTime: null, message: '未接続' },
      };
    case 'START_SYNC':
      return {
        ...state,
        syncStatus: { ...state.syncStatus, isSyncing: true, message: '同期中...' },
      };
    case 'COMPLETE_SYNC': {
      const now = new Date();
      const newLog: SyncLog = {
        id: `sl-${now.getTime()}`,
        timestamp: now,
        result: 'success',
        coursesFetched: state.courses.length,
        assignmentsFetched: state.assignments.length,
        announcementsFetched: state.announcements.length,
      };
      return {
        ...state,
        lastSynced: now,
        syncStatus: { isSyncing: false, lastSyncTime: now, message: '同期完了' },
        syncLogs: [newLog, ...state.syncLogs],
      };
    }
    case 'UPDATE_CALENDAR_SETTINGS':
      return {
        ...state,
        calendarExportSettings: { ...state.calendarExportSettings, ...action.payload },
      };
    case 'START_CALENDAR_EXPORT':
      return { ...state, calendarConnectionStatus: 'preparing' };
    case 'COMPLETE_CALENDAR_EXPORT': {
      const now = new Date();
      const newLog: CalendarExportLog = {
        id: `cel-${now.getTime()}`,
        exportedAt: now,
        exportType: action.payload.exportType,
        eventCount: action.payload.eventCount,
        status: 'success',
      };
      return {
        ...state,
        calendarConnectionStatus: 'exported',
        calendarLastExported: now,
        calendarExportLogs: [newLog, ...state.calendarExportLogs],
      };
    }
    case 'FAIL_CALENDAR_EXPORT': {
      const now = new Date();
      const newLog: CalendarExportLog = {
        id: `cel-${now.getTime()}`,
        exportedAt: now,
        exportType: action.payload.exportType,
        eventCount: 0,
        status: 'failed',
        errorMessage: action.payload.errorMessage,
      };
      return {
        ...state,
        calendarConnectionStatus: 'failed',
        calendarExportLogs: [newLog, ...state.calendarExportLogs],
      };
    }
    case 'DISCONNECT_CALENDAR':
      return { ...state, calendarConnectionStatus: 'disconnected' };
    case 'HYDRATE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}

type ContextValue = {
  state: State;
  universities: University[];
  selectUniversity: (id: string) => void;
  startConnection: () => void;
  completeConnection: () => void;
  resetConnection: () => void;
  disconnect: () => void;
  sync: () => void;
  updateCalendarSettings: (partial: Partial<CalendarExportSettings>) => void;
  exportCalendar: (type: CalendarExportType) => Promise<void>;
  disconnectCalendar: () => void;
};

const PortalContext = createContext<ContextValue | null>(null);

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const stored = localStorage.getItem('portalState');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        dispatch({
          type: 'HYDRATE',
          payload: {
            selectedUniversityId: parsed.selectedUniversityId ?? initialState.selectedUniversityId,
            connectionStatus: parsed.connectionStatus ?? initialState.connectionStatus,
            lastSynced: parsed.lastSynced ? new Date(parsed.lastSynced) : null,
            syncStatus: parsed.syncStatus
              ? {
                  ...parsed.syncStatus,
                  lastSyncTime: parsed.syncStatus.lastSyncTime
                    ? new Date(parsed.syncStatus.lastSyncTime)
                    : null,
                }
              : initialState.syncStatus,
            syncLogs: Array.isArray(parsed.syncLogs)
              ? parsed.syncLogs.map((log: SyncLog) => ({
                  ...log,
                  timestamp: new Date(log.timestamp),
                }))
              : initialState.syncLogs,
            calendarConnectionStatus:
              parsed.calendarConnectionStatus ?? initialState.calendarConnectionStatus,
            calendarLastExported: parsed.calendarLastExported
              ? new Date(parsed.calendarLastExported)
              : null,
            calendarExportSettings: parsed.calendarExportSettings
              ? { ...defaultCalendarExportSettings, ...parsed.calendarExportSettings }
              : initialState.calendarExportSettings,
            calendarExportLogs: Array.isArray(parsed.calendarExportLogs)
              ? parsed.calendarExportLogs.map((log: CalendarExportLog) => ({
                  ...log,
                  exportedAt: new Date(log.exportedAt),
                }))
              : initialState.calendarExportLogs,
          },
        });
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      'portalState',
      JSON.stringify({
        selectedUniversityId: state.selectedUniversityId,
        connectionStatus: state.connectionStatus,
        lastSynced: state.lastSynced,
        syncStatus: state.syncStatus,
        syncLogs: state.syncLogs,
        calendarConnectionStatus: state.calendarConnectionStatus,
        calendarLastExported: state.calendarLastExported,
        calendarExportSettings: state.calendarExportSettings,
        calendarExportLogs: state.calendarExportLogs,
      })
    );
  }, [
    state.selectedUniversityId,
    state.connectionStatus,
    state.lastSynced,
    state.syncStatus,
    state.syncLogs,
    state.calendarConnectionStatus,
    state.calendarLastExported,
    state.calendarExportSettings,
    state.calendarExportLogs,
  ]);

  const selectUniversity = (id: string) => dispatch({ type: 'SELECT_UNIVERSITY', universityId: id });

  const startConnection = () => dispatch({ type: 'START_CONNECTION' });

  const completeConnection = () => dispatch({ type: 'COMPLETE_CONNECTION' });

  const resetConnection = () => dispatch({ type: 'RESET_CONNECTION' });

  const disconnect = () => dispatch({ type: 'RESET_CONNECTION' });

  const sync = () => {
    dispatch({ type: 'START_SYNC' });
    setTimeout(() => dispatch({ type: 'COMPLETE_SYNC' }), 1800);
  };

  const updateCalendarSettings = (partial: Partial<CalendarExportSettings>) =>
    dispatch({ type: 'UPDATE_CALENDAR_SETTINGS', payload: partial });

  const exportCalendar = async (type: CalendarExportType) => {
    dispatch({ type: 'START_CALENDAR_EXPORT' });
    try {
      const settings = state.calendarExportSettings;
      const effectiveSettings: CalendarExportSettings = {
        ...settings,
        includeCourses: type === 'all' ? settings.includeCourses : type === 'courses',
        includeAssignments: type === 'all' ? settings.includeAssignments : type === 'assignments',
        includeAnnouncements: type === 'all' ? settings.includeAnnouncements : false,
      };

      const events = buildCalendarEvents(
        {
          courses: state.courses,
          timetableSlots: state.timetableSlots,
          assignments: state.assignments,
          announcements: state.announcements,
        },
        effectiveSettings
      );

      const ics = generateICS(events, 'UniPortal');
      const filename = `uniportal-calendar-${type}-${Date.now()}.ics`;
      downloadICS(ics, filename);

      await new Promise((resolve) => setTimeout(resolve, 1200));
      dispatch({ type: 'COMPLETE_CALENDAR_EXPORT', payload: { eventCount: events.length, exportType: type } });
    } catch (err) {
      dispatch({
        type: 'FAIL_CALENDAR_EXPORT',
        payload: { errorMessage: err instanceof Error ? err.message : '不明なエラーが発生しました。', exportType: type },
      });
    }
  };

  const disconnectCalendar = () => dispatch({ type: 'DISCONNECT_CALENDAR' });

  return (
    <PortalContext.Provider
      value={{
        state,
        universities,
        selectUniversity,
        startConnection,
        completeConnection,
        resetConnection,
        disconnect,
        sync,
        updateCalendarSettings,
        exportCalendar,
        disconnectCalendar,
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortal must be used within PortalProvider');
  return ctx;
}
