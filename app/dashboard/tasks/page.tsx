import Link from 'next/link';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { listTasks, membersWithNothing } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  await requireLead();
  const db = getDb();
  const today = chicagoDay(new Date());
  const [tasks, nothing] = await Promise.all([listTasks(db), membersWithNothing(db, today)]);
  const t = copy.tasks;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl">{t.title}</h1>
        <Link href="/dashboard/tasks/new" className="btn-pill bg-arcade-fuel text-ink">{t.newTask}</Link>
      </div>

      <p
        data-testid="no-task-line"
        className={`mt-6 inline-block rounded-xl border-2 border-ink px-4 py-2 font-bold text-ink ${nothing.length ? 'bg-arcade-fuel' : 'bg-arcade-mint'}`}
      >
        {nothing.length ? t.noTask(nothing.length) : t.noTaskNone}
      </p>

      {tasks.length === 0 ? (
        <p className="mt-8 text-lg text-paper/80">{t.empty}</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {tasks.map((task) => (
            <li key={task.id} className={`rounded-xl border-2 p-4 ${task.state === 'published' ? 'border-paper/40 bg-deep' : 'border-paper/15 bg-deep/60 text-paper/70'}`}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h2 className="font-sans text-xl font-bold tracking-normal">{task.title}</h2>
                  <p className="mt-1 text-sm text-paper/70">
                    {task.audience === 'pool' ? t.forPool : task.audience === 'subteam' ? t.forSubteam(task.subteamName ?? '') : t.forPeople(task.people.join(', '))}
                    {task.dueDay && <span className="ml-3">{copy.kiosk.dueOn(dayLabel(task.dueDay))}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">{task.state === 'draft' ? t.stateDraft : task.state === 'published' ? t.statePublished : t.stateClosed}</span>
                  {task.standing && <span className="chip !bg-arcade-fuel">{t.standing}</span>}
                  {task.state !== 'draft' && <span className="text-sm text-paper/70">{t.openCount(task.open)}, {t.doneCount(task.done)}</span>}
                  <Link href={`/dashboard/tasks/${task.id}`} className="btn-small">{t.edit}</Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
