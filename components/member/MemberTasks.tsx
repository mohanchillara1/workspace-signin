'use client';

import { useOptimistic, useTransition } from 'react';
import { finishTask, takeTask, tickSteps } from '@/app/m/[key]/actions';
import { TaskCard, TaskGroups } from '@/components/TaskCard';
import { copy } from '@/lib/copy';
import type { Handout } from '@/lib/tasks';

export function MemberTasks({ pageKey, tasks }: { pageKey: string; tasks: Handout[] }) {
  const [pending, startTransition] = useTransition();
  // Show a tick the moment it is tapped; the server's answer follows.
  const [shown, setTicks] = useOptimistic(tasks, (current, change: { key: string; stepsDone: number[] }) =>
    current.map((t) => (t.key === change.key ? { ...t, stepsDone: change.stepsDone } : t)),
  );

  if (shown.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="text-xl">{copy.member.nothingTitle}</h3>
        <p className="mt-1">{copy.member.nothingBody}</p>
      </div>
    );
  }

  return (
    <TaskGroups
      tasks={shown}
      size="phone"
      render={(handout) => (
        <TaskCard
          key={handout.key}
          handout={handout}
          size="phone"
          stepsAlwaysOpen
          busy={pending}
          onTake={() => startTransition(() => takeTask(pageKey, handout.taskId))}
          onDone={() => startTransition(() => finishTask(pageKey, handout.taskId, handout.assignmentId))}
          onSteps={
            handout.assignmentId && handout.group !== 'pool'
              ? (stepsDone) =>
                  startTransition(async () => {
                    setTicks({ key: handout.key, stepsDone });
                    await tickSteps(pageKey, handout.assignmentId!, stepsDone);
                  })
              : undefined
          }
        />
      )}
    />
  );
}
