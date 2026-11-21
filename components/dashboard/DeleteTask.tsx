'use client';

import { useState } from 'react';
import { deleteTaskAction } from '@/app/dashboard/tasks/actions';
import { copy } from '@/lib/copy';

/** Deleting asks twice: the first tap shows the real button. */
export function DeleteTask({ taskId }: { taskId: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const t = copy.tasks;
  return (
    <section data-testid="delete-task" className="mt-10 max-w-2xl rounded-xl border-2 border-arcade-bumper/70 bg-deep p-5">
      <h2 className="text-2xl">{t.deleteTitle}</h2>
      <p className="mt-2 text-sm text-paper/75">{t.deleteHelp}</p>
      {asking ? (
        <form action={deleteTaskAction} onSubmit={() => setPending(true)} className="mt-4 flex flex-wrap gap-3">
          <input type="hidden" name="id" value={taskId} />
          <button type="submit" disabled={pending} className="btn-pill bg-arcade-bumper text-paper !shadow-none">{t.deleteConfirm}</button>
          <button type="button" disabled={pending} onClick={() => setAsking(false)} className="btn-pill bg-paper text-ink !shadow-none">{t.deleteCancel}</button>
        </form>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="btn-pill mt-4 bg-paper text-ink !shadow-none">{t.deleteButton}</button>
      )}
    </section>
  );
}
