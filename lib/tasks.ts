import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from './db/client';
import { assignments, members, submissions, subteams, tasks, type Assignment, type Task } from './db/schema';
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
  /** sent_back: a lead looked at it and wants it redone. */
  state: 'open' | 'claimed' | 'sent_back';
  /** Whether finishing it sends it to a lead first. */
  needsCheck: boolean;
  /** What the lead wrote when sending it back. */
  sentBackComment: string | null;
  /** A pool task this member took and may put back. */
  canGiveBack: boolean;
  dueDay: string | null;
  overdue: boolean;
  standing: boolean;
};

export type DoneVia = 'kiosk' | 'member_page' | 'lead' | 'slack';

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
  /** False once the task itself is closed. */
  canReopen: boolean;
};

const TITLE_MAX = 120;
const TEXT_MAX = 2000;
const STEP_MAX = 200;
const STEPS_MAX = 12;
// On someone's list.
const LIVE = ['open', 'claimed', 'sent_back'] as const;
// Finished by the member: waiting for a check, or through.
const SETTLED = ['done', 'submitted', 'approved'] as const;
// Finished for good: shown on the leads' Finished list.
const FINISHED = ['done', 'approved'] as const;

function clean(input: TaskInput) {
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (!title) throw new UserError('taskTitle');
  if (title.length > TITLE_MAX) throw new UserError('taskTitleLong');
  const description = (input.description ?? '').trim();
  if (description.length > TEXT_MAX) throw new UserError('taskDescriptionLong');
  const steps = (input.steps ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (steps.length > STEPS_MAX) throw new UserError('taskStepsMany');
  if (steps.some((s) => s.length > STEP_MAX)) throw new UserError('taskStepLong');
  const standing = input.standing ?? false;
  // A standing task (clean the bench) always lives in the pool.
  const audience = standing ? 'pool' : input.audience;
  const memberIds = audience === 'person' ? [...new Set(input.memberIds ?? [])] : [];
  const subteamId = audience === 'subteam' ? (input.subteamId ?? null) : null;
  if (audience === 'person' && memberIds.length === 0) throw new UserError('taskNoPeople');
  if (audience === 'subteam' && !subteamId) throw new UserError('taskNoSubteam');
  const dueDay = input.dueDay || null;
  if (dueDay && !isDay(dueDay)) throw new UserError('taskBadDue');
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

/** Holds the task's row until the transaction ends, so two changes to one task take turns. */
async function lockTask(tx: Db, taskId: string): Promise<Task | null> {
  await tx.execute(sql`select 1 from ${tasks} where ${tasks.id} = ${taskId} for update`);
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  return task ?? null;
}

const isLive = (row: Assignment) => (LIVE as readonly string[]).includes(row.state);
const isSettled = (row: Assignment) => (SETTLED as readonly string[]).includes(row.state);

/**
 * Makes a published task's hand-outs match what the task now says.
 *
 * It closes live hand-outs that no longer belong (a person taken off the
 * task, a member who left the subteam) and adds the missing ones. Finished
 * hand-outs are never touched, and nobody gets a second copy of something
 * they finished. With `fresh`, who the task is for has changed shape (a
 * different subteam, pool instead of people, and so on): everything live
 * closes and the task is handed out anew.
 *
 * Call it inside a transaction that holds lockTask().
 */
async function reconcile(tx: Db, task: Task, options: { fresh: boolean }): Promise<void> {
  const now = new Date();
  const rows = await tx.select().from(assignments).where(eq(assignments.taskId, task.id));
  const live = rows.filter(isLive);
  // What already answers the task. After a change of shape, finished history
  // no longer counts, but work waiting for a lead's check still does: it is
  // not handed out a second time while a lead has it.
  const done = rows.filter((r) => (options.fresh ? r.state === 'submitted' : isSettled(r)));
  const keep = new Set<string>();
  const add: (typeof assignments.$inferInsert)[] = [];

  const perMember = task.audience === 'person' || (task.audience === 'subteam' && task.completion === 'each');
  if (perMember) {
    let wanted = task.memberIds;
    if (task.audience === 'person' && wanted.length) {
      // Someone who has been deactivated cannot see or finish a task, so they
      // hold none. They get it back if they are reactivated.
      const active = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(inArray(members.id, wanted), eq(members.active, true)));
      const activeIds = new Set(active.map((p) => p.id));
      wanted = wanted.filter((id) => activeIds.has(id));
    }
    if (task.audience === 'subteam') {
      const people = task.subteamId
        ? await tx
            .select({ id: members.id })
            .from(members)
            .where(and(eq(members.subteamId, task.subteamId), eq(members.active, true)))
        : [];
      wanted = people.map((p) => p.id);
    }
    const wantedSet = new Set(wanted);
    const have = new Set<string>();
    if (!options.fresh) {
      for (const row of live) {
        if (row.memberId && !row.day && wantedSet.has(row.memberId) && !have.has(row.memberId)) {
          keep.add(row.id);
          have.add(row.memberId);
        }
      }
    }
    for (const row of done) if (row.memberId) have.add(row.memberId);
    // "Done once for the group" and already done, or sent back to the one who
    // did it: nobody else gets it again.
    const finishedOnce =
      task.audience === 'person' &&
      task.completion === 'once' &&
      (done.length > 0 || (!options.fresh && live.some((r) => r.state === 'sent_back')));
    if (!finishedOnce) {
      for (const memberId of wanted) if (!have.has(memberId)) add.push({ taskId: task.id, memberId });
    }
  } else if (task.audience === 'subteam') {
    const row = options.fresh ? undefined : live.find((r) => !r.memberId && r.subteamId === task.subteamId);
    if (row) keep.add(row.id);
    else if (done.length === 0 && task.subteamId) add.push({ taskId: task.id, subteamId: task.subteamId });
  } else if (task.standing) {
    // A standing task gets a row only when someone takes or finishes it that day.
    if (!options.fresh) for (const row of live) if (row.day) keep.add(row.id);
  } else {
    const row = options.fresh ? undefined : live.find((r) => !r.subteamId && !r.day);
    if (row) keep.add(row.id);
    else if (done.length === 0) add.push({ taskId: task.id });
  }

  const stale = live.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (stale.length) {
    await tx.update(assignments).set({ state: 'closed', closedAt: now }).where(inArray(assignments.id, stale));
  }
  if (add.length) await tx.insert(assignments).values(add);
}

const shapeOf = (task: Pick<Task, 'audience' | 'subteamId' | 'completion' | 'standing'>) =>
  `${task.audience}|${task.subteamId ?? ''}|${task.completion}|${task.standing}`;

export async function updateTask(db: Db, taskId: string, input: TaskInput, actorId: string | null): Promise<void> {
  const values = clean(input);
  await db.transaction(async (tx) => {
    const before = await lockTask(tx, taskId);
    if (!before) throw new UserError('taskMissing');
    const [task] = await tx
      .update(tasks)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning();
    await logChange(tx, { actorId, action: 'task.edit', entity: 'task', entityId: taskId });
    if (task.state === 'published') await reconcile(tx, task, { fresh: shapeOf(before) !== shapeOf(task) });
  });
}

/**
 * Publishes a task and hands it out, as one step: if the hand-out fails the
 * task stays as it was. Publishing twice, or two leads publishing at the
 * same moment, hands it out once.
 */
export async function publishTask(db: Db, taskId: string, actorId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await lockTask(tx, taskId);
    if (!before) throw new UserError('taskMissing');
    const [task] = await tx
      .update(tasks)
      .set({ state: 'published', publishedAt: before.publishedAt ?? new Date(), closedAt: null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning();
    await reconcile(tx, task, { fresh: false });
    await logChange(tx, { actorId, action: 'task.publish', entity: 'task', entityId: taskId });
  });
}

/** A lead closes a task. Whatever was still open leaves every list. */
export async function closeTask(db: Db, taskId: string, actorId: string | null): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await lockTask(tx, taskId);
    await tx.update(tasks).set({ state: 'closed', closedAt: now, updatedAt: now }).where(eq(tasks.id, taskId));
    // Work waiting for a check goes too: the lead has ended the task, so
    // there is nothing left to approve or send back.
    await tx
      .update(assignments)
      .set({ state: 'closed', closedAt: now })
      .where(and(eq(assignments.taskId, taskId), inArray(assignments.state, [...LIVE, 'submitted'])));
    await logChange(tx, { actorId, action: 'task.close', entity: 'task', entityId: taskId });
  });
}

/**
 * Brings one member's hand-outs in line after they are added, moved to
 * another subteam, deactivated or reactivated: they get their subteam's
 * "everyone does their own" tasks, lose the old subteam's, and a pool task
 * held by someone who was deactivated goes back to the pool.
 */
export async function syncMember(db: Db, memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [member] = await tx.select().from(members).where(eq(members.id, memberId));
    if (!member) return;
    const now = new Date();
    if (!member.active) {
      const held = await tx
        .select({ row: assignments, task: tasks })
        .from(assignments)
        .innerJoin(tasks, eq(assignments.taskId, tasks.id))
        .where(
          and(
            eq(assignments.memberId, memberId),
            inArray(assignments.state, ['claimed', 'sent_back']),
            eq(tasks.audience, 'pool'),
          ),
        );
      for (const { row, task } of held) await unclaim(tx, row, task);
    }
    // Tasks given to this person by name follow them out and back in.
    const own = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.state, 'published'),
          eq(tasks.audience, 'person'),
          sql`${tasks.memberIds} @> ${JSON.stringify([memberId])}::jsonb`,
        ),
      );
    for (const { id } of own) {
      const task = await lockTask(tx, id);
      if (task && task.state === 'published') await reconcile(tx, task, { fresh: false });
    }
    const each = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.state, 'published'), eq(tasks.audience, 'subteam'), eq(tasks.completion, 'each')));
    for (const task of each) {
      await lockTask(tx, task.id);
      const mine = await tx
        .select()
        .from(assignments)
        .where(and(eq(assignments.taskId, task.id), eq(assignments.memberId, memberId)));
      const belongs = member.active && member.subteamId !== null && member.subteamId === task.subteamId;
      if (belongs) {
        if (!mine.some((r) => isLive(r) || isSettled(r))) {
          await tx.insert(assignments).values({ taskId: task.id, memberId });
        }
      } else {
        const stale = mine.filter(isLive).map((r) => r.id);
        if (stale.length) {
          await tx.update(assignments).set({ state: 'closed', closedAt: now }).where(inArray(assignments.id, stale));
        }
      }
    }
  });
}

function toHandout(task: Task, row: Assignment | null, memberId: string, today: string, comment: string | null = null): Handout {
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
    state: row?.state === 'claimed' ? 'claimed' : row?.state === 'sent_back' ? 'sent_back' : 'open',
    needsCheck: task.needsCheck,
    sentBackComment: row?.state === 'sent_back' ? comment : null,
    canGiveBack: task.audience === 'pool' && claimedByMe && (row?.state === 'claimed' || row?.state === 'sent_back'),
    dueDay: task.dueDay,
    overdue: task.dueDay !== null && task.dueDay < today,
    standing: task.standing,
  };
}

/**
 * The same list for the iPad on the wall. A lead's comment on someone's work
 * is for that member's own page, not a screen the room can read, so it is
 * taken out before the list leaves the server.
 */
export function forKiosk(handouts: Handout[]): Handout[] {
  return handouts.map((handout) => ({ ...handout, sentBackComment: null }));
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
        // A standing task's row belongs to one day. Sent-back work is the
        // exception: it stays with its member until they send it in again.
        or(isNull(assignments.day), eq(assignments.day, today), and(mine, eq(assignments.state, 'sent_back'))),
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
  // What the lead wrote on each hand-out that was sent back.
  const sentBack = rows.filter((r) => r.row.state === 'sent_back').map((r) => r.row.id);
  const comments = new Map<string, string>();
  if (sentBack.length) {
    const notes = await db
      .select({ assignmentId: submissions.assignmentId, comment: submissions.comment })
      .from(submissions)
      .where(and(inArray(submissions.assignmentId, sentBack), eq(submissions.decision, 'sent_back')))
      .orderBy(submissions.reviewedAt);
    for (const note of notes) comments.set(note.assignmentId, note.comment);
  }
  const list = [
    ...rows.map((r) => ({
      handout: toHandout(r.task, r.row, memberId, today, comments.get(r.row.id) ?? null),
      createdAt: r.task.createdAt,
    })),
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
  const [member] = await db.select().from(members).where(eq(members.id, input.memberId));
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId));
  if (!member || !member.active || !task || task.state !== 'published' || task.audience !== 'pool') return { ok: false };
  const now = new Date();
  if (task.standing) {
    const made = await db
      .insert(assignments)
      .values({ taskId: task.id, memberId: member.id, day: input.today, state: 'claimed', claimedAt: now })
      .onConflictDoNothing()
      .returning({ id: assignments.id });
    return { ok: made.length === 1 };
  }
  // One row at most, picked and held in the same statement.
  const free = sql`(select ${assignments.id} from ${assignments}
    where ${assignments.taskId} = ${task.id} and ${assignments.memberId} is null and ${assignments.subteamId} is null
      and ${assignments.day} is null and ${assignments.state} = 'open'
    limit 1 for update skip locked)`;
  const taken = await db
    .update(assignments)
    .set({ memberId: member.id, state: 'claimed', claimedAt: now })
    .where(and(sql`${assignments.id} = ${free}`, eq(assignments.state, 'open')))
    .returning({ id: assignments.id });
  return { ok: taken.length === 1 };
}

const HELD = ['claimed', 'sent_back'] as const;

/** Puts a held pool hand-out (taken, or sent back to its taker) back. False if it was not held any more. */
async function unclaim(db: Db, row: Assignment, task: Task): Promise<boolean> {
  if (task.standing && row.state === 'claimed') {
    // A standing claim is only a marker for that day. Removing it frees the task.
    const gone = await db
      .delete(assignments)
      .where(and(eq(assignments.id, row.id), eq(assignments.state, 'claimed')))
      .returning({ id: assignments.id });
    return gone.length === 1;
  }
  if (task.standing) {
    // Sent-back standing work has a record behind it, so it closes rather than
    // vanishes. The task itself is up for grabs again each day anyway.
    const closed = await db
      .update(assignments)
      .set({ state: 'closed', closedAt: new Date() })
      .where(and(eq(assignments.id, row.id), eq(assignments.state, 'sent_back')))
      .returning({ id: assignments.id });
    return closed.length === 1;
  }
  const freed = await db
    .update(assignments)
    .set({ memberId: null, state: 'open', claimedAt: null, stepsDone: [] })
    .where(and(eq(assignments.id, row.id), inArray(assignments.state, HELD)))
    .returning({ id: assignments.id });
  return freed.length === 1;
}

async function claimedPoolRow(db: Db, assignmentId: string) {
  const [found] = await db
    .select({ row: assignments, task: tasks })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(eq(assignments.id, assignmentId));
  return found && found.task.audience === 'pool' && (HELD as readonly string[]).includes(found.row.state) ? found : null;
}

/** A lead takes a pool task back from whoever claimed it. */
export async function release(db: Db, assignmentId: string, actorId: string | null): Promise<void> {
  const found = await claimedPoolRow(db, assignmentId);
  if (!found || !(await unclaim(db, found.row, found.task))) return;
  await logChange(db, {
    actorId,
    action: 'assignment.release',
    entity: 'assignment',
    entityId: assignmentId,
    detail: { taskId: found.task.id },
  });
}

/** A member puts back a pool task they took. */
export async function giveBack(
  db: Db,
  input: { assignmentId: string; memberId: string },
): Promise<{ ok: boolean }> {
  const found = await claimedPoolRow(db, input.assignmentId);
  if (!found || found.row.memberId !== input.memberId) return { ok: false };
  return { ok: await unclaim(db, found.row, found.task) };
}

/** May this member act on this hand-out? */
function isFor(row: Assignment, task: Task, member: { id: string; subteamId: string | null }): boolean {
  if (row.memberId) return row.memberId === member.id;
  if (row.subteamId) return row.subteamId === member.subteamId;
  return task.audience === 'pool';
}

export type FinishInput = {
  taskId: string;
  assignmentId?: string;
  memberId: string;
  via: DoneVia;
  today: string;
  /** True: a task that needs a lead's check goes to "submitted". False: always "done". */
  check: boolean;
};

/**
 * A member finishes a hand-out. This is the only place that happens. With
 * `check`, a task that needs a lead's check goes to "submitted" and waits;
 * otherwise it is "done". Either way it leaves the member's list, and a
 * "done once for the group" task closes for the others at the same moment.
 * Two people finishing at once take turns: the second is told no.
 *
 * Runs inside the caller's transaction, so the caller can save a note in the
 * same step. Returns the hand-out's id for that.
 */
export async function finishHandout(
  tx: Db,
  input: FinishInput,
): Promise<{ ok: boolean; state?: 'done' | 'submitted'; assignmentId?: string }> {
  const task = await lockTask(tx, input.taskId);
  const [member] = await tx.select().from(members).where(eq(members.id, input.memberId));
  if (!member || !member.active || !task || task.state !== 'published') return { ok: false };
  const now = new Date();
  const state = input.check && task.needsCheck ? ('submitted' as const) : ('done' as const);
  const finish = { state, doneById: member.id, doneAt: now, doneVia: input.via };

  if (!input.assignmentId) {
    // Only a standing task can be finished without a hand-out row.
    if (!task.standing) return { ok: false };
    const made = await tx
      .insert(assignments)
      .values({ taskId: task.id, memberId: member.id, day: input.today, ...finish })
      .onConflictDoNothing()
      .returning({ id: assignments.id });
    if (made.length === 1) return { ok: true, state, assignmentId: made[0].id };
    const mine = await tx
      .update(assignments)
      .set(finish)
      .where(
        and(
          eq(assignments.taskId, task.id),
          eq(assignments.day, input.today),
          eq(assignments.memberId, member.id),
          inArray(assignments.state, ['claimed', 'sent_back']),
        ),
      )
      .returning({ id: assignments.id });
    return mine.length === 1 ? { ok: true, state, assignmentId: mine[0].id } : { ok: false };
  }

  const [row] = await tx
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, input.assignmentId), eq(assignments.taskId, task.id)));
  if (!row || !isFor(row, task, member)) return { ok: false };
  const changed = await tx
    .update(assignments)
    .set({ ...finish, memberId: row.memberId ?? (task.audience === 'pool' ? member.id : null) })
    .where(and(eq(assignments.id, row.id), inArray(assignments.state, LIVE)))
    .returning({ id: assignments.id });
  if (changed.length !== 1) return { ok: false };
  if (task.audience === 'person' && task.completion === 'once') {
    // Done once for the group: the others' copies close at the same moment.
    await tx
      .update(assignments)
      .set({ state: 'closed', closedAt: now })
      .where(and(eq(assignments.taskId, task.id), inArray(assignments.state, LIVE)));
  }
  return { ok: true, state, assignmentId: row.id };
}

/** The plain "Done" with no lead's check, whatever the task says. Phase 1's behaviour. */
export async function markDone(
  db: Db,
  input: { taskId: string; assignmentId?: string; memberId: string; via: DoneVia; today: string },
): Promise<{ ok: boolean }> {
  const result = await db.transaction((tx) => finishHandout(tx, { ...input, check: false }));
  return { ok: result.ok };
}

/**
 * A lead's answer on work that is waiting: approved finishes it; sent back
 * puts it on the member's list again. Only moves the hand-out. The caller
 * records who decided and the comment, in the same transaction.
 */
export async function settleReview(
  tx: Db,
  input: { assignmentId: string; decision: 'approved' | 'sent_back' },
): Promise<{ ok: boolean; taskId?: string }> {
  const [first] = await tx.select().from(assignments).where(eq(assignments.id, input.assignmentId));
  if (!first) return { ok: false };
  await lockTask(tx, first.taskId);
  const changed = await tx
    .update(assignments)
    .set({ state: input.decision })
    .where(and(eq(assignments.id, input.assignmentId), eq(assignments.state, 'submitted')))
    .returning({ id: assignments.id });
  return changed.length === 1 ? { ok: true, taskId: first.taskId } : { ok: false };
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
  const theirs =
    found.row.memberId === member.id ||
    (!found.row.memberId && found.row.subteamId !== null && found.row.subteamId === member.subteamId);
  if (!theirs || !isLive(found.row)) return { ok: false };
  const count = found.task.steps.length;
  const stepsDone = [...new Set(input.stepsDone.filter((i) => Number.isInteger(i) && i >= 0 && i < count))].sort(
    (x, y) => x - y,
  );
  await db.update(assignments).set({ stepsDone }).where(eq(assignments.id, found.row.id));
  return { ok: true };
}

/**
 * A lead puts finished work back on the list of whoever finished it, and nobody
 * else's. Only while the task is still published.
 */
export async function reopen(db: Db, assignmentId: string, actorId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [first] = await tx.select().from(assignments).where(eq(assignments.id, assignmentId));
    if (!first) return;
    const task = await lockTask(tx, first.taskId);
    const [row] = await tx.select().from(assignments).where(eq(assignments.id, assignmentId));
    if (!task || task.state !== 'published' || !row || !(FINISHED as readonly string[]).includes(row.state)) return;
    const back = task.audience === 'pool' ? ('claimed' as const) : ('open' as const);
    await tx
      .update(assignments)
      .set({ state: back, doneById: null, doneAt: null, doneVia: null })
      .where(eq(assignments.id, assignmentId));
    await logChange(tx, {
      actorId,
      action: 'assignment.reopen',
      entity: 'assignment',
      entityId: assignmentId,
      detail: { taskId: task.id },
    });
  });
}

/** Finished work, newest first, for the leads' Finished list. */
export async function finished(db: Db, options: { limit: number }): Promise<FinishedRow[]> {
  const rows = await db
    .select({ row: assignments, task: tasks, first: members.firstName, last: members.lastName })
    .from(assignments)
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .leftJoin(members, eq(assignments.doneById, members.id))
    .where(inArray(assignments.state, FINISHED))
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
    canReopen: r.task.state === 'published',
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

export type TaskListRow = Task & {
  subteamName: string | null;
  /** On someone's list. */
  open: number;
  /** Sent in, waiting for a lead's check. */
  waiting: number;
  /** Finished. */
  done: number;
  people: string[];
};

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
      open: mine.filter((c) => (LIVE as readonly string[]).includes(c.state)).reduce((sum, c) => sum + c.n, 0),
      waiting: mine.filter((c) => c.state === 'submitted').reduce((sum, c) => sum + c.n, 0),
      done: mine.filter((c) => (FINISHED as readonly string[]).includes(c.state)).reduce((sum, c) => sum + c.n, 0),
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
