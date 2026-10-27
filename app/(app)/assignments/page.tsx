'use client';

import { usePortal } from '@/store/portalStore';
import AssignmentCard from '@/components/AssignmentCard';
import { Assignment, AssignmentStatus } from '@/types';

const groups: { status: AssignmentStatus; label: string }[] = [
  { status: 'pending', label: '未提出' },
  { status: 'submitted', label: '提出済み' },
  { status: 'overdue', label: '期限切れ' },
];

export default function AssignmentsPage() {
  const { state } = usePortal();
  const { courses, assignments } = state;

  const byStatus = (status: AssignmentStatus): Assignment[] =>
    assignments
      .filter((a) => a.status === status)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return (
    <div className="px-4 pt-6 pb-4 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">課題</h1>

      {groups.map((group) => {
        const items = byStatus(group.status);
        return (
          <section key={group.status}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-900">{group.label}</h2>
              <span className="text-xs text-gray-400">{items.length}件</span>
            </div>
            {items.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
                該当する課題はありません
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((assignment) => (
                  <AssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    course={courses.find((c) => c.id === assignment.courseId)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
