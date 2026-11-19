import { TaskForm } from '@/components/dashboard/TaskForm';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { listMembers, listSubteams } from '@/lib/members';
import { EMPTY_TASK } from '@/lib/task-form';

export const dynamic = 'force-dynamic';

export default async function NewTaskPage() {
  await requireLead();
  const db = getDb();
  const [members, subteams] = await Promise.all([listMembers(db), listSubteams(db)]);
  const people = members.filter((m) => m.active).map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() }));
  return (
    <>
      <h1 className="mb-6 text-5xl">{copy.tasks.formNewTitle}</h1>
      <TaskForm initial={EMPTY_TASK} people={people} subteams={subteams} />
    </>
  );
}
