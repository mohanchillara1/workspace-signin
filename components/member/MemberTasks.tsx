'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { finishTask, putBack, sendIn, takeTask, tickSteps, type SendResult } from '@/app/m/[key]/actions';
import { SendInForm } from '@/components/member/SendInForm';
import { TaskCard, TaskGroups } from '@/components/TaskCard';
import { copy } from '@/lib/copy';
import type { Handout } from '@/lib/tasks';

export function MemberTasks({ pageKey, tasks }: { pageKey: string; tasks: Handout[] }) {
  const [pending, startTransition] = useTransition();
  // What the last send-in came to: told once, in words, above the list.
  const [told, setTold] = useState<{ good: boolean; text: string } | null>(null);
  const tell = (result: SendResult) =>
    setTold(result.ok ? (result.state === 'submitted' ? { good: true, text: copy.submit.sentIn } : null) : { good: false, text: result.message });
  // Show a tick the moment it is tapped; the server's answer follows.
  const [shown, setTicks] = useOptimistic(tasks, (current, change: { key: string; stepsDone: number[] }) =>
    current.map((t) => (t.key === change.key ? { ...t, stepsDone: change.stepsDone } : t)),
  );

  const message = told && (
    <p
      role={told.good ? 'status' : 'alert'}
      data-testid="send-result"
      className={`mb-4 rounded-xl border-2 border-ink px-4 py-3 text-base font-semibold shadow-hard-sm ${told.good ? 'bg-arcade-mint text-ink' : 'bg-arcade-bumper text-paper'}`}
    >
      {told.text}
    </p>
  );

  if (shown.length === 0) {
    return (
      <>
        {message}
        <div className="card p-5">
          <h3 className="text-xl">{copy.member.nothingTitle}</h3>
          <p className="mt-1">{copy.member.nothingBody}</p>
        </div>
      </>
    );
  }

  return (
    <>
      {message}
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
          onPutBack={handout.assignmentId ? () => startTransition(() => putBack(pageKey, handout.assignmentId!)) : undefined}
          onDone={() =>
            startTransition(async () => {
              tell(await finishTask(pageKey, handout.taskId, handout.assignmentId));
            })
          }
          doneForm={(close) => (
            <SendInForm
              onCancel={close}
              onSend={async (note, link) => {
                const result = await sendIn(pageKey, handout.taskId, handout.assignmentId, note, link);
                if (!result.ok) return result.message;
                tell(result);
                close();
                return null;
              }}
            />
          )}
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
    </>
  );
}
