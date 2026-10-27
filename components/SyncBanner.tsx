'use client';

import { usePortal } from '@/store/portalStore';
import { universities } from '@/data/dummyData';

export default function SyncBanner() {
  const { state } = usePortal();
  const { syncStatus } = state;
  const university = universities.find((u) => u.id === state.selectedUniversityId);
  const themeColor = university?.themeColor ?? '#003366';

  if (!syncStatus.isSyncing) return null;

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-medium"
      style={{ backgroundColor: themeColor }}
    >
      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>{syncStatus.message}</span>
    </div>
  );
}
