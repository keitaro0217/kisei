'use client';

import Link from 'next/link';
import { usePortal } from '@/store/portalStore';
import { universities } from '@/data/dummyData';

const days = ['月', '火', '水', '木', '金'];
const dayNumbers = [1, 2, 3, 4, 5];
const periods = [1, 2, 3, 4, 5, 6];
const periodTimes = ['9:00-10:30', '10:45-12:15', '13:00-14:30', '14:45-16:15', '16:30-18:00', '18:15-19:45'];

export default function TimetablePage() {
  const { state } = usePortal();
  const { courses, timetableSlots } = state;

  const university = universities.find((u) => u.id === state.selectedUniversityId);
  const themeColor = university?.themeColor ?? '#003366';

  const todayDow = new Date().getDay();

  const getSlot = (day: number, period: number) =>
    timetableSlots.find((s) => s.dayOfWeek === day && s.period === period);

  return (
    <div className="pt-6 pb-4">
      <div className="px-4 mb-4">
        <h1 className="text-xl font-bold text-gray-900">時間割</h1>
      </div>

      <div className="overflow-x-auto px-2">
        <div className="min-w-[340px]">
          <div className="grid grid-cols-[44px_repeat(5,1fr)] gap-0.5 mb-0.5">
            <div />
            {days.map((day, i) => (
              <div
                key={day}
                className="text-center text-xs font-bold py-1.5 rounded-t-lg"
                style={{
                  backgroundColor: dayNumbers[i] === todayDow ? themeColor : 'transparent',
                  color: dayNumbers[i] === todayDow ? 'white' : '#6B7280',
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {periods.map((period) => (
            <div key={period} className="grid grid-cols-[44px_repeat(5,1fr)] gap-0.5 mb-0.5">
              <div className="flex flex-col items-center justify-center py-1">
                <span className="text-xs font-bold text-gray-700">{period}限</span>
                <span className="text-[9px] text-gray-400 leading-tight text-center">
                  {periodTimes[period - 1].split('-')[0]}
                </span>
              </div>
              {dayNumbers.map((day) => {
                const slot = getSlot(day, period);
                const course = slot ? courses.find((c) => c.id === slot.courseId) : null;
                const isToday = day === todayDow;

                const cellStyle = {
                  backgroundColor: course ? `${course.color}18` : isToday ? '#F3F4F6' : '#F9FAFB',
                  border: course ? `1.5px solid ${course.color}40` : '1.5px solid transparent',
                };

                if (!course) {
                  return (
                    <div
                      key={day}
                      className="rounded-lg p-1.5 min-h-[64px] flex flex-col justify-center"
                      style={cellStyle}
                    />
                  );
                }

                return (
                  <Link
                    key={day}
                    href={`/timetable/${course.id}`}
                    className="rounded-lg p-1.5 min-h-[64px] flex flex-col justify-center"
                    style={cellStyle}
                  >
                    <p
                      className="text-[10px] font-bold leading-tight"
                      style={{ color: course.color }}
                    >
                      {course.name}
                    </p>
                    <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">{course.room}</p>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
