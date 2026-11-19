import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['member', 'lead', 'captain']);
export const audienceEnum = pgEnum('audience', ['person', 'subteam', 'pool']);
export const completionEnum = pgEnum('completion', ['once', 'each']);
export const taskStateEnum = pgEnum('task_state', ['draft', 'published', 'closed']);
// open, claimed, sent_back: on someone's list. submitted: waiting for a lead's
// check. done (no check needed) and approved: finished. closed: taken off.
export const assignmentStateEnum = pgEnum('assignment_state', [
  'open',
  'claimed',
  'done',
  'closed',
  'submitted',
  'sent_back',
  'approved',
]);
export const decisionEnum = pgEnum('decision', ['approved', 'sent_back']);
export const sourceEnum = pgEnum('source', ['kiosk', 'manual']);
export const doneViaEnum = pgEnum('done_via', ['kiosk', 'member_page', 'lead']);

const at = (name: string) => timestamp(name, { withTimezone: true });

export const subteams = pgTable('subteams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: at('created_at').notNull().defaultNow(),
});

// No email, phone number or birthday: the design collects none.
export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull().default(''),
  subteamId: uuid('subteam_id').references(() => subteams.id, { onDelete: 'set null' }),
  role: roleEnum('role').notNull().default('member'),
  active: boolean('active').notNull().default(true),
  scanCode: text('scan_code').notNull().unique(),
  pageKey: text('page_key').notNull().unique(),
  createdAt: at('created_at').notNull().defaultNow(),
  deactivatedAt: at('deactivated_at'),
});

export const kiosks = pgTable('kiosks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  pairedById: uuid('paired_by_id').references(() => members.id),
  pairedAt: at('paired_at').notNull().defaultNow(),
  revokedAt: at('revoked_at'),
  lastSeenAt: at('last_seen_at'),
});

// One row per member per Central day. The unique index is what makes a second
// scan on the same day harmless.
export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id').notNull().references(() => members.id),
    day: date('day', { mode: 'string' }).notNull(),
    firstScanAt: at('first_scan_at').notNull(),
    source: sourceEnum('source').notNull(),
    recordedById: uuid('recorded_by_id').references(() => members.id),
    kioskId: uuid('kiosk_id').references(() => kiosks.id),
  },
  (t) => [uniqueIndex('attendance_member_day').on(t.memberId, t.day), index('attendance_day').on(t.day)],
);

// A day a lead struck out (test scans). It no longer counts as a meeting day.
export const struckDays = pgTable('struck_days', {
  day: date('day', { mode: 'string' }).primaryKey(),
  struckById: uuid('struck_by_id').references(() => members.id),
  struckAt: at('struck_at').notNull().defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  steps: jsonb('steps').$type<string[]>().notNull().default([]),
  audience: audienceEnum('audience').notNull(),
  subteamId: uuid('subteam_id').references(() => subteams.id),
  // For a task given to several people or a subteam: done once for the group,
  // or everyone does their own.
  completion: completionEnum('completion').notNull().default('once'),
  // The people a person-task is for, kept so a draft remembers them.
  memberIds: jsonb('member_ids').$type<string[]>().notNull().default([]),
  dueDay: date('due_day', { mode: 'string' }),
  standing: boolean('standing').notNull().default(false),
  needsCheck: boolean('needs_check').notNull().default(true),
  state: taskStateEnum('state').notNull().default('draft'),
  createdById: uuid('created_by_id').references(() => members.id),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
  publishedAt: at('published_at'),
  closedAt: at('closed_at'),
});

// One row per hand-out of a task. Each has its own state.
//   person task          one row per named member
//   subteam task, once   one row with subteam_id and no member
//   subteam task, each   one row per member of the subteam
//   pool task            one row with no member until someone claims it
//   standing pool task   no row until someone claims or finishes it that day;
//                        then one row per day (day is set)
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id').notNull().references(() => tasks.id),
    memberId: uuid('member_id').references(() => members.id),
    subteamId: uuid('subteam_id').references(() => subteams.id),
    state: assignmentStateEnum('state').notNull().default('open'),
    day: date('day', { mode: 'string' }),
    stepsDone: jsonb('steps_done').$type<number[]>().notNull().default([]),
    claimedAt: at('claimed_at'),
    doneById: uuid('done_by_id').references(() => members.id),
    doneAt: at('done_at'),
    doneVia: doneViaEnum('done_via'),
    closedAt: at('closed_at'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('assignments_member_state').on(t.memberId, t.state),
    index('assignments_task').on(t.taskId),
    uniqueIndex('assignments_standing_day').on(t.taskId, t.day).where(sql`${t.day} is not null`),
  ],
);

// Each time a member sends finished work in for a lead's check. A hand-out
// that is sent back and sent in again has two rows, so the history is kept.
// AI never reads these rows.
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id),
    memberId: uuid('member_id').notNull().references(() => members.id),
    note: text('note').notNull().default(''),
    link: text('link').notNull().default(''),
    via: doneViaEnum('via').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    // The lead's answer. All null while it waits.
    decision: decisionEnum('decision'),
    comment: text('comment').notNull().default(''),
    reviewedById: uuid('reviewed_by_id').references(() => members.id),
    reviewedAt: at('reviewed_at'),
  },
  (t) => [index('submissions_assignment').on(t.assignmentId)],
);

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdById: uuid('created_by_id').references(() => members.id),
  createdAt: at('created_at').notNull().defaultNow(),
  expiresAt: at('expires_at').notNull(),
  usedAt: at('used_at'),
});

// A lead's login. version goes up when a new invite is issued or the login is
// reset, which ends every session made before it.
export const leadLogins = pgTable('lead_logins', {
  memberId: uuid('member_id').primaryKey().references(() => members.id),
  loginName: text('login_name').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

// A session a lead ended by logging out (or by turning a device into the
// kiosk). The cookie may still exist somewhere; it no longer opens anything.
export const endedSessions = pgTable('ended_sessions', {
  sid: text('sid').primaryKey(),
  endedAt: at('ended_at').notNull().defaultNow(),
});

export const rateHits = pgTable(
  'rate_hits',
  {
    key: text('key').notNull(),
    windowStart: at('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// Hand edits to attendance, task edits, new codes, pairing: who did what.
export const changeLog = pgTable(
  'change_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: at('at').notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => members.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('change_log_at').on(t.at)],
);

export type Member = typeof members.$inferSelect;
export type Subteam = typeof subteams.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Kiosk = typeof kiosks.$inferSelect;
export type AttendanceRow = typeof attendance.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
