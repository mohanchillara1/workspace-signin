import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { assignments, changeLog, submissions, tasks } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { submitWork } from '@/lib/submit';
import { createTask, deleteTask, openFor, publishTask } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-20';

describe('deleting a task', () => {
  const getDb = useTestDb();

  it('removes the task, its hand-outs and anything sent in, and leaves other tasks alone', async () => {
    const db = getDb();
    const lead = await addMember(db, { firstName: 'Del', lastName: 'Lead', role: 'lead' }, null);
    const m = await addMember(db, { firstName: 'Del', lastName: 'Member' }, null);
    const gone = await createTask(db, { title: 'Delete me', audience: 'person', memberIds: [m.id] }, lead.id);
    const kept = await createTask(db, { title: 'Keep me', audience: 'person', memberIds: [m.id] }, lead.id);
    await publishTask(db, gone.id, lead.id);
    await publishTask(db, kept.id, lead.id);
    const line = (await openFor(db, m.id, TODAY)).find((h) => h.title === 'Delete me')!;
    await submitWork(db, { taskId: gone.id, assignmentId: line.assignmentId, memberId: m.id, note: 'done', link: '', via: 'member_page', today: TODAY });

    await deleteTask(db, gone.id, lead.id);

    expect(await db.select().from(tasks).where(eq(tasks.id, gone.id))).toHaveLength(0);
    expect(await db.select().from(assignments).where(eq(assignments.taskId, gone.id))).toHaveLength(0);
    expect(await db.select().from(submissions)).toHaveLength(0);
    expect((await openFor(db, m.id, TODAY)).map((h) => h.title)).toEqual(['Keep me']);
    const log = await db.select().from(changeLog).where(eq(changeLog.action, 'task.delete'));
    expect(log).toHaveLength(1);
    expect(log[0].detail).toMatchObject({ title: 'Delete me' });
  });

  it('deletes a draft that was never published', async () => {
    const db = getDb();
    const draft = await createTask(db, { title: 'Draft only', audience: 'pool' }, null);
    await deleteTask(db, draft.id, null);
    expect(await db.select().from(tasks).where(eq(tasks.id, draft.id))).toHaveLength(0);
  });
});
