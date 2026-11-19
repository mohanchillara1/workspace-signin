import { notFound } from 'next/navigation';
import { takeBack } from '@/app/dashboard/tasks/actions';
import { TaskForm } from '@/components/dashboard/TaskForm';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { listMembers, listSubteams } from '@/lib/members';
import { taskToForm } from '@/lib/task-form';
import { handoutsOf, taskById } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  await requireLead();
  const { id } = await params;
  const { note } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const task = await taskById(db, id);
  if (!task) notFound();
  const [members, subteams, handouts] = await Promise.all([listMembers(db), listSubteams(db), handoutsOf(db, id)]);
  const people = members
    .filter((m) => m.active || task.memberIds.includes(m.id))
    .map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() }));
  const t = copy.tasks;
  const noteText = note === 'published' ? t.published : note === 'closed' ? t.closed : note === 'saved' ? t.saved : '';
  const stateLabel = { open: t.handoutOpen, claimed: t.handoutClaimed, done: t.handoutDone, closed: t.handoutClosed };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-5xl">{t.formEditTitle}</h1>
        <span className="chip">{task.state === 'draft' ? t.stateDraft : task.state === 'published' ? t.statePublished : t.stateClosed}</span>
      </div>
      {noteText && (
        <p role="status" className="mb-5 inline-block rounded-full border-2 border-ink bg-arcade-mint px-4 py-1 font-bold text-ink">
          {noteText}
        </p>
      )}
      <TaskForm key={`${task.id}-${task.updatedAt.getTime()}`} initial={taskToForm(task)} people={people} subteams={subteams} />

      <section className="mt-10 max-w-3xl">
        <h2 className="text-2xl">{t.handoutsTitle}</h2>
        {handouts.length === 0 ? (
          <p className="mt-2 text-paper/75">{t.handoutsNone}</p>
        ) : (
          <ul className="mt-3 divide-y-2 divide-paper/10">
            {handouts.map((h) => (
              <li key={h.assignmentId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-bold">{h.who || t.handoutPool}</span>
                  {h.day && <span className="ml-2 text-sm text-paper/70">{dayLabel(h.day)}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="chip">{stateLabel[h.state]}</span>
                  {h.state === 'claimed' && task.audience === 'pool' && (
                    <form action={takeBack}>
                      <input type="hidden" name="assignmentId" value={h.assignmentId} />
                      <button type="submit" className="btn-small">{t.takeBack}</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
