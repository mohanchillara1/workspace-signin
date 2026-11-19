import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { copy } from './copy';
import type { Db } from './db/client';
import { assignments, members, subteams, tasks, type Assignment, type Task } from './db/schema';
import { isDay } from './day';
import { UserError } from './errors';
import { logChange } from './log';
import { shortName } from './names';

export type TaskInput = {
  title: string;
  description?: string;
  steps?: string[];
  audience: 'person' | 'subteam' | 'pool';
  memberIds?: string[];
  subteamId?: string | null;
  completion?: 'once' | 'each';
  dueDay?: string | null;
  standing?: boolean;
  needsCheck?: boolean;
};

/** One line in a member's list: a hand-out, or a standing task nobody has taken today. */
export type Handout = {
  key: string;
  taskId: string;
  assignmentId?: string;
  title: string;
  description: string;
  steps: string[];
  stepsDone: number[];
  group: 'yours' | 'subteam' | 'pool';
  state: 'open' | 'claimed';
  dueDay: string | null;
  overdue: boolean;
  standing: boolean;
};

export type DoneVia = 'kiosk' | 'member_page' | 'lead';

export type FinishedRow = {
  assignmentId: string;
  taskId: string;
  title: string;
  /** First name and last initial. */
  doneBy: string;
  /** The whole name, for the leads' dashboard only. */
  doneByFull: string;
  doneAt: Date;
  doneVia: DoneVia;
  needsCheck: boolean;
  standing: boolean;
};

const TITLE_MAX = 120;
const TEXT_MAX = 2000;
const STEP_MAX = 200;
const STEPS_MAX = 12;
const LIVE = ['open', 'claimed'] as const;

function clean(input: TaskInput) {
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (!title) throw new UserError(copy.errors.taskTitle);
  if (title.length > TITLE_MAX) throw new UserError(copy.errors.taskTitleLong(TITLE_MAX));
  const description = (input.description ?? '').trim();
  if (description.length > TEXT_MAX) throw new UserError(copy.errors.taskDescriptionLong(TEXT_MAX));
  const steps = (input.steps ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (steps.length > STEPS_MAX) throw new UserError(copy.errors.taskStepsMany(STEPS_MAX));
  if (steps.some((s) => s.length > STEP_MAX)) throw new UserError(copy.errors.taskStepLong(STEP_MAX));
  const standing = input.standing ?? false;
  // A standing task (clean the bench) always lives in the pool.
  const audience = standing ? 'pool' : input.audience;
  const memberIds = audience === 'person' ? [...new Set(input.memberIds ?? [])] : [];
  const subteamId = audience === 'subteam' ? (input.subteamId ?? null) : null;
  if (audience === 'person' && memberIds.length === 0) throw new UserError(copy.errors.taskNoPeople);
  if (audience === 'subteam' && !subteamId) throw new UserError(copy.errors.taskNoSubteam);
  const dueDay = input.dueDay || null;
  if (dueDay && !isDay(dueDay)) throw new UserError(copy.errors.taskBadDue);
  return {
    title,
    description,
    steps,
    audience,
    memberIds,
    subteamId,
    completion: input.completion ?? ('once' as const),
    dueDay,
    standing,
    // Chores skip the lead's check unless a lead turns it on.
    needsCheck: input.needsCheck ?? !standing,
  };
}

export async function createTask(db: Db, input: TaskInput, actorId: string | null): Promise<Task> {
  const [task] = await db
    .insert(tasks)
    .values({ ...clean(input), createdById: actorId })
    .returning();
  await logChange(db, { actorId, action: 'task.create', entity: 'task', entityId: task.id });
  return task;
}

export async function updateTask(db: Db, taskId: string, input: TaskInput, actorId: string | null): Promise<void> {
  const values = clean(input);
  const [task] = await db
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!task) throw new UserError(copy.errors.taskMissing);
  await logChange(db, { actorId, action: 'task.edit', entity: 'task', entityId: taskId });
  if (task.state === 'published') await handOut(db, task);
}

/** Makes the hand-outs a published task should have and does not have yet. */
async function handOut(db: Db, task: Task): Promise<void> {
  const existing = await db.select().from(assignments).where(eq(assignments.taskId, task.id));
  const haveMember = new Set(existing.map((a) => a.memberId).filter(Boolean));
  const rows: (typeof assignments.$inferInsert)[] = [];
  if (task.audience === 'person') {
    for (const memberId of task.memberIds) {
      if (!haveMember.has(memberId)) rows.push({ taskId: task.id, memberId });
    }
  } else if (task.audience === 'subteam' && task.subteamId) {
    if (task.completion === 'each') {
      const people = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.subteamId, task.subteamId), eq(members.active, true)));
      for (const person of people) {
        if (!haveMember.has(person.id)) rows.push({ taskId: task.id, memberId: person.id });
      }
    } else if (existing.length === 0) {
      rows.push({ taskId: task.id, subteamId: task.subteamId });
    }
  } else if (task.audience === 'pool' && !task.standing && existing.length === 0) {
    rows.push({ taskId: task.id });
  }
  // A standing task gets a row only when someone takes or finishes it that day.
  if (rows.length) await db.insert(assignments).values(rows);
}

export async function publishTask(db: Db, taskId: string, actorId: string | null): Promise<void> {
  const [task] = await db
    .update(tasks)
    .set({ state: 'published', publishedAt: new Date(), closedAt: null, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!task) throw new UserError(copy.errors.taskMissing);
  await handOut(db, task);
  await logChange(db, { actorId, action: 'task.publish', entity: 'task', entityId: taskId });
}

/** A lead closes a task. Whatever was still open leaves every list. */
export async function closeTask(db: Db, taskId: string, actorId: string | null): Promise<void> {
  const now = new Date();
  await db.update(tasks).set({ state: 'closed', closedAt: now, updatedAt: now }).where(eq(tasks.id, taskId));
  await db
    .update(assignments)
    .set({ state: 'closed', closedAt: now })
    .where(and(eq(assignments.taskId, taskId), inArray(assignments.state, LIVE)));
  await logChange(db, { actorId, action: 'task.close', entity: 'task', entityId: taskId });
}

function toHandout(task: Task, row: Assignment | null, memberId: string, today: string): Handout {
  const claimedByMe = row?.memberId === memberId;
  const group: Handout['group'] =
    task.audience === 'subteam' ? 'subteam' : task.audience === 'pool' && !claimedByMe ? 'pool' : 'yours';
  return {
    key: row?.id ?? `task:${task.id}`,
    taskId: task.id,
    assignmentId: row?.id,
    title: task.title,
    description: task.description,
    steps: task.steps,
    stepsDone: row?.stepsDone ?? [],
    group,
    state: row?.state === 'claimed' ? 'claimed' : 'open',
    dueDay: task.dueDay,
    overdue: task.dueDay !== null && task.dueDay < today,
    standing: task.standing,
  };
}

const GROUP_ORDER = { yours: 0, subteam: 1, pool: 2 } as const;

/**
 * Everything a member could work on today: their own first, then their
 * subteam's, then the open pool. Soonest due day first inside each group.
 */
export async function openFor(db: Db, memberId: string, today: string): Promise<Handout[]> {
  const [member] = await db.select().from(members).where(eq(members.id, memberId));
  if (!member) return [];
  const mine = eq(assignments.memberId, memberId);
  const myTeams = member.subteamId
    ? and(isNull(assignments.memberId), eq(assignments.subteamId, member.subteamId))
    : sql`false`;
  const unclaimedPool = and(isNull(assignments.memberId), isNull(assignments.subteamId), eq(tasks.audience, 'pool'));
  const rows = await db
    .select({ row: assignments, task: tasks })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(
      and(
        eq(tasks.state, 'published'),
        inArray(assignments.state, LIVE),
        or(mine, myTeams, unclaimedPool),
        or(isNull(assignments.day), eq(assignments.day, today)),
      ),
    );
  // Standing tasks nobody has taken or finished today.
  const takenToday = db
    .select({ taskId: assignments.taskId })
    .from(assignments)
    .where(eq(assignments.day, today));
  const standing = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.state, 'published'), eq(tasks.standing, true), sql`${tasks.id} not in ${takenToday}`));
  const list = [
    ...rows.map((r) => ({ handout: toHandout(r.task, r.row, memberId, today), createdAt: r.task.createdAt })),
    ...standing.map((task) => ({ handout: toHandout(task, null, memberId, today), createdAt: task.createdAt })),
  ];
  list.sort(
    (x, y) =>
      GROUP_ORDER[x.handout.group] - GROUP_ORDER[y.handout.group] ||
      (x.handout.dueDay ?? '9999').localeCompare(y.handout.dueDay ?? '9999') ||
      x.createdAt.getTime() - y.createdAt.getTime(),
  );
  return list.map((entry) => entry.handout);
}

/** "I'll take this" on a pool task. Only one person can hold it at a time. */
export async function claim(
  db: Db,
  input: { taskId: string; memberId: string; today: string },
): Promise<{ ok: boolean }> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId));
  if (!task || task.state !== 'published' || task.audience !== 'pool') return { ok: false };
  const now = new Date();
  if (task.standing) {
    const made = await db
      .insert(assignments)
      .values({ taskId: task.id, memberId: input.memberId, day: input.today, state: 'claimed', claimedAt: now })
      .onConflictDoNothing()
      .returning({ id: assignments.id });
    return { ok: made.length === 1 };
  }
  const taken = await db
    .update(assignments)
    .set({ memberId: input.memberId, state: 'claimed', claimedAt: now })
    .where(and(eq(assignments.taskId, task.id), isNull(assignments.memberId), eq(assignments.state, 'open')))
    .returning({ id: assignments.id });
  return { ok: taken.length === 1 };
}

/** A lead takes a pool task back from whoever claimed it. */
export async function release(db: Db, assignmentId: string, actorId: string | null): Promise<void> {
  const [found] = await db
    .select({ row: assignments, task: tasks })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(eq(assignments.id, assignmentId));
  if (!found || found.task.audience !== 'pool' || found.row.state !== 'claimed') return;
  if (found.task.standing) {
    // A standing claim is only a marker for that day. Removing it frees the task.
    await db.delete(assignments).where(eq(assignments.id, assignmentId));
  } else {
    await db
      .update(assignments)
      .set({ memberId: null, state: 'open', claimedAt: null, stepsDone: [] })
      .where(eq(assignments.id, assignmentId));
  }
  await logChange(db, {
    actorId,
    action: 'assignment.release',
    entity: 'assignment',
    entityId: assignmentId,
    detail: { taskId: found.task.id },
  });
}

/** May this member act on this hand-out? */
function isFor(row: Assignment, task: Task, member: { id: string; subteamId: string | null }): boolean {
  if (row.memberId) return row.memberId === member.id;
  if (row.subteamId) return row.subteamId === member.subteamId;
  return task.audience === 'pool';
}

/**
 * The plain "Done" tap. The hand-out leaves the member's list and lands on
 * the leads' Finished list.
 */
export async function markDone(
  db: Db,
  input: { taskId: string; assignmentId?: string; memberId: string; via: DoneVia; today: string },
): Promise<{ ok: boolean }> {
  const [member] = await db.select().from(members).where(eq(members.id, input.memberId));
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId));
  if (!member || !member.active || !task || task.state !== 'published') return { ok: false };
  const now = new Date();
  const done = { state: 'done' as const, doneById: member.id, doneAt: now, doneVia: input.via };

  if (!input.assignmentId) {
    // Only a standing task can be finished without a hand-out row.
    if (!task.standing) return { ok: false };
    const made = await db
      .insert(assignments)
      .values({ taskId: task.id, memberId: member.id, day: input.today, ...done })
      .onConflictDoNothing()
      .returning({ id: assignments.id });
    if (made.length === 1) return { ok: true };
    const mine = await db
      .update(assignments)
      .set(done)
      .where(
        and(
          eq(assignments.taskId, task.id),
          eq(assignments.day, input.today),
          eq(assignments.memberId, member.id),
          eq(assignments.state, 'claimed'),
        ),
      )
      .returning({ id: assignments.id });
    return { ok: mine.length === 1 };
  }

  const [row] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, input.assignmentId), eq(assignments.taskId, task.id)));
  if (!row || !isFor(row, task, member)) return { ok: false };
  const changed = await db
    .update(assignments)
    .set({ ...done, memberId: row.memberId ?? (task.audience === 'pool' ? member.id : null) })
    .where(and(eq(assignments.id, row.id), inArray(assignments.state, LIVE)))
    .returning({ id: assignments.id });
  if (changed.length !== 1) return { ok: false };
  if (task.audience === 'person' && task.completion === 'once') {
    // Done once for the group: the others' copies close at the same moment.
    await db
      .update(assignments)
      .set({ state: 'closed', closedAt: now })
      .where(and(eq(assignments.taskId, task.id), inArray(assignments.state, LIVE)));
  }
  return { ok: true };
}

/** Saves which steps a member has ticked. */
export async function setStepsDone(
  db: Db,
  input: { assignmentId: string; memberId: string; stepsDone: number[] },
): Promise<{ ok: boolean }> {
  const [member] = await db.select().from(members).where(eq(members.id, input.memberId));
  const [found] = await db
    .select({ row: assignments, task: tasks })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(eq(assignments.id, input.assignmentId));
  if (!member || !found) return { ok: false };
  // Ticks are kept only on a hand-out that is this member's or their subteam's.
  const theirs = found.row.memberId === member.id || (!found.row.memberId && found.row.subteamId === member.subteamId && found.row.subteamId !== null);
  if (!theirs || !LIVE.includes(found.row.state as (typeof LIVE)[number])) return { ok: false };
  const count = found.task.steps.length;
  const stepsDone = [...new Set(input.stepsDone.filter((i) => Number.isInteger(i) && i >= 0 && i < count))].sort(
    (x, y) => x - y,
  );
  await db.update(assignments).set({ stepsDone }).where(eq(assignments.id, found.row.id));
  return { ok: true };
}

/** A lead puts finished work back on the member's list. */
export async function reopen(db: Db, assignmentId: string, actorId: string | null): Promise<void> {
  const [found] = await db
    .select({ row: assignments, task: tasks })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(eq(assignments.id, assignmentId));
  if (!found || found.row.state !== 'done') return;
  const back = found.task.audience === 'pool' ? ('claimed' as const) : ('open' as const);
  await db
    .update(assignments)
    .set({ state: back, doneById: null, doneAt: null, doneVia: null })
    .where(eq(assignments.id, assignmentId));
  if (found.task.audience === 'person' && found.task.completion === 'once' && found.row.doneAt) {
    // The copies that closed with it come back too.
    await db
      .update(assignments)
      .set({ state: 'open', closedAt: null })
      .where(
        and(
          eq(assignments.taskId, found.task.id),
          eq(assignments.state, 'closed'),
          eq(assignments.closedAt, found.row.doneAt),
        ),
      );
  }
  await logChange(db, {
    actorId,
    action: 'assignment.reopen',
    entity: 'assignment',
    entityId: assignmentId,
    detail: { taskId: found.task.id },
  });
}

/** Finished work, newest first, for the leads' Finished list. */
export async function finished(db: Db, options: { limit: number }): Promise<FinishedRow[]> {
  const rows = await db
    .select({ row: assignments, task: tasks, first: members.firstName, last: members.lastName })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .leftJoin(members, eq(assignments.doneById, members.id))
    .where(eq(assignments.state, 'done'))
    .orderBy(desc(assignments.doneAt))
    .limit(options.limit);
  return rows.map((r) => ({
    assignmentId: r.row.id,
    taskId: r.task.id,
    title: r.task.title,
    doneBy: r.first ? shortName(r.first, r.last ?? '') : '',
    doneByFull: r.first ? `${r.first} ${r.last ?? ''}`.trim() : '',
    doneAt: r.row.doneAt ?? r.row.createdAt,
    doneVia: r.row.doneVia ?? 'lead',
    needsCheck: r.task.needsCheck,
    standing: r.task.standing,
  }));
}

/** Active members with no open task of their own or their subteam's. */
export async function membersWithNothing(
  db: Db,
  today: string,
): Promise<{ memberId: string; name: string; subteam: string | null }[]> {
  const live = await db
    .select({ memberId: assignments.memberId, subteamId: assignments.subteamId })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(
      and(
        eq(tasks.state, 'published'),
        inArray(assignments.state, LIVE),
        or(isNull(assignments.day), eq(assignments.day, today)),
      ),
    );
  const busyMembers = new Set(live.map((r) => r.memberId).filter(Boolean));
  const busySubteams = new Set(live.filter((r) => !r.memberId && r.subteamId).map((r) => r.subteamId));
  const people = await db
    .select({ member: members, subteam: subteams.name })
    .from(members)
    .leftJoin(subteams, eq(members.subteamId, subteams.id))
    .where(eq(members.active, true))
    .orderBy(members.firstName, members.lastName);
  return people
    .filter((p) => !busyMembers.has(p.member.id) && !(p.member.subteamId && busySubteams.has(p.member.subteamId)))
    .map((p) => ({ memberId: p.member.id, name: shortName(p.member.firstName, p.member.lastName), subteam: p.subteam }));
}

export type TaskListRow = Task & { subteamName: string | null; open: number; done: number; people: string[] };

/** Every task with who it is for and how its hand-outs stand, newest first. */
export async function listTasks(db: Db): Promise<TaskListRow[]> {
  const all = await db
    .select({ task: tasks, subteamName: subteams.name })
    .from(tasks)
    .leftJoin(subteams, eq(tasks.subteamId, subteams.id))
    .orderBy(desc(tasks.createdAt));
  const counts = await db
    .select({ taskId: assignments.taskId, state: assignments.state, n: sql<number>`count(*)::int` })
    .from(assignments)
    .groupBy(assignments.taskId, assignments.state);
  const names = new Map(
    (await db.select().from(members)).map((m) => [m.id, `${m.firstName} ${m.lastName}`.trim()] as const),
  );
  return all.map(({ task, subteamName }) => {
    const mine = counts.filter((c) => c.taskId === task.id);
    return {
      ...task,
      subteamName,
      open: mine.filter((c) => c.state === 'open' || c.state === 'claimed').reduce((sum, c) => sum + c.n, 0),
      done: mine.filter((c) => c.state === 'done').reduce((sum, c) => sum + c.n, 0),
      people: task.memberIds.map((id) => names.get(id) ?? '').filter(Boolean),
    };
  });
}

export async function taskById(db: Db, id: string): Promise<Task | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  return task ?? null;
}

export type TaskHandoutRow = { assignmentId: string; state: Assignment['state']; who: string; day: string | null };

/** A task's hand-outs with names, for the task's own page. */
export async function handoutsOf(db: Db, taskId: string): Promise<TaskHandoutRow[]> {
  const rows = await db
    .select({ row: assignments, first: members.firstName, last: members.lastName, subteam: subteams.name })
    .from(assignments)
    .leftJoin(members, eq(assignments.memberId, members.id))
    .leftJoin(subteams, eq(assignments.subteamId, subteams.id))
    .where(eq(assignments.taskId, taskId))
    .orderBy(assignments.createdAt);
  return rows.map((r) => ({
    assignmentId: r.row.id,
    state: r.row.state,
    who: r.first ? `${r.first} ${r.last ?? ''}`.trim() : (r.subteam ?? ''),
    day: r.row.day,
  }));
}
