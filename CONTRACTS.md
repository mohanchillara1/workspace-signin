# Phase 2 contracts

Three lanes build phase 2 at the same time, each in its own git worktree. This file is what they share. A lane builds to it and does not change it. If something here is wrong or missing, the lane says so in its report and works around it inside its own files.

Phase 2 adds three things (DESIGN §7.2, §7.3 Review, §7.4, §7.6):

1. **Mark done.** A member marks a task done with a short note and an optional link. Their page shows where each one stands: waiting, approved, or sent back with the lead's comment.
2. **Review queue.** A lead approves, or sends back with a comment. The member sends it again. The task's "needs a lead's check" switch decides whether a finished task goes through the queue at all.
3. **Step drafts.** "Draft steps" on the task form asks an AI service for three to eight short steps. The lead edits them. Nothing is published until the lead saves. Built and tested against a stand-in: **no real call to any AI service, no API key.** With no key set, the button is not there.

AI never reads a submission and never judges work. Photo upload is not part of this.

## What is already in place (do not change these files)

`lib/db/schema.ts` and `drizzle/0002_*.sql`:

- `assignment_state` now has `open`, `claimed`, `sent_back` (on someone's list), `submitted` (waiting for a lead), `done` and `approved` (finished), `closed`.
- Table `submissions`: `id`, `assignmentId`, `memberId`, `note`, `link`, `via` (`kiosk` or `member_page`), `createdAt`, then the lead's answer, all null or empty while it waits: `decision` (`approved` or `sent_back`), `comment`, `reviewedById`, `reviewedAt`. One row each time a member sends work in.

`lib/tasks.ts`:

```ts
// One line on a member's list.
type Handout = {
  key: string; taskId: string; assignmentId?: string;
  title: string; description: string; steps: string[]; stepsDone: number[];
  group: 'yours' | 'subteam' | 'pool';
  state: 'open' | 'claimed' | 'sent_back';
  needsCheck: boolean;            // finishing it sends it to a lead first
  sentBackComment: string | null; // what the lead wrote, when state is 'sent_back'
  canGiveBack: boolean; dueDay: string | null; overdue: boolean; standing: boolean;
};

openFor(db, memberId, today): Promise<Handout[]>   // includes sent-back work, with the comment

// A member finishes a hand-out. The ONLY place that happens. Call it inside a
// transaction. With check: true, a task that needs a check becomes 'submitted';
// otherwise 'done'. Returns the hand-out's id so a note can be saved with it.
finishHandout(tx, { taskId, assignmentId?, memberId, via, today, check: boolean })
  : Promise<{ ok: boolean; state?: 'done' | 'submitted'; assignmentId?: string }>

// A lead's answer on waiting work. Call it inside a transaction. It only moves
// the hand-out ('submitted' -> 'approved' or 'sent_back'); the caller writes
// who decided and the comment onto the submissions row in the same transaction.
settleReview(tx, { assignmentId, decision: 'approved' | 'sent_back' })
  : Promise<{ ok: boolean; taskId?: string }>

finished(db, { limit })   // lists 'done' and 'approved'
reopen(db, assignmentId, actorId)   // works on 'done' and 'approved'
listTasks(db)             // each row has open, waiting, done counts
```

Other things lanes use as they are: `lib/errors.ts` (`UserError` takes a key from `copy.errors`), `lib/ids.ts` (`isUuid`), `lib/auth/session.ts` (`requireLead`, `clientAddress`), `lib/kiosk-api.ts` (`answer`, `body`, `json`, `kioskOr401`), `lib/log.ts` (`logChange`), `lib/day.ts`, `components/TaskCard.tsx` props.

## What each lane builds

| Lane | File | Function | What it does |
|---|---|---|---|
| a | `lib/submit.ts` | `submitWork(db, { taskId, assignmentId?, memberId, note, link, via, today })` returns `{ ok: boolean; state?: 'submitted' \| 'done' }` | One transaction: `finishHandout(tx, { ..., check: true })`, and when the state is `submitted`, one `submissions` row. Note: trimmed, at most 500 characters, may be empty. Link: empty, or starts with `https://` and is at most 300 characters; anything else is refused before anything is written. |
| a | `lib/submit.ts` | `standingFor(db, memberId)` returns rows `{ assignmentId, title, state: 'waiting' \| 'approved' \| 'sent_back', note, link, comment, at }`, newest first, at most 20 | Where each of a member's submissions stands. |
| b | `lib/review.ts` | `reviewQueue(db)` returns rows `{ assignmentId, submissionId, taskId, title, member (whole name), note, link, via, at }`, oldest first | Work waiting for a lead. |
| b | `lib/review.ts` | `decide(db, { assignmentId, decision: 'approved' \| 'sent_back', comment, actorId })` returns `{ ok: boolean }` | One transaction: the actor must be an active lead or captain; `settleReview`; write `decision`, `comment` (at most 500 characters), `reviewedById`, `reviewedAt` on the newest waiting submission of that hand-out; `logChange`. A send-back with an empty comment is refused. |
| c | `lib/step-drafts.ts` | `draftsAvailable(): boolean` | True only when `ANTHROPIC_API_KEY` is set. |
| c | `lib/step-drafts.ts` | `draftSteps(input: { title: string; description: string; subteam: string \| null }, client?: StepClient): Promise<string[]>` | Three to eight steps, one action each, each at most 200 characters. `StepClient` is the small interface the real client and the test stand-in both meet. Sends the title, description and subteam name only: never a member's name, a submission, or anything else. |

Routes and screens:

- **Lane a.** The member page `/m/[key]` and the kiosk's `POST /api/kiosk/done` call `submitWork`. On the kiosk "Done" stays two taps with no note (`note: ''`); the member page asks for the note and link when the task needs a check. The member page gains a "Sent in" list from `standingFor`, and a sent-back task shows the lead's comment on its card.
- **Lane b.** A new screen `/dashboard/review` and its link in the dashboard menu. The Finished screen stays the list of finished work.
- **Lane c.** A server action `draftStepsAction` in `app/dashboard/tasks/draft-action.ts` and a "Draft steps" button in the task form that fills the Steps box. The page passes `canDraft={draftsAvailable()}` to the form.

Words: each lane's strings go in its own file, `lib/copy/submit.ts`, `lib/copy/review.ts` or `lib/copy/drafts.ts`, as `copy.submit`, `copy.review`, `copy.drafts`. Do not edit `lib/copy.ts` or `COPY.md` (the builder rebuilds `COPY.md` at merge; the test that compares them will fail in a lane until then, and that one failure is expected).

## Who owns which files

| Lane | May create or change | Must not touch |
|---|---|---|
| a. Mark done | `lib/submit.ts`, `lib/copy/submit.ts`, `app/m/[key]/**`, `components/member/**`, `app/api/kiosk/done/route.ts`, `components/kiosk/**`, `components/TaskCard.tsx`, `tests/db/submit.test.ts`, `tests/e2e/05-submit.spec.ts`, and the existing browser tests `01` to `04` only where a "Done" tap now behaves differently | everything else |
| b. Review queue | `lib/review.ts`, `lib/copy/review.ts`, `app/dashboard/review/**`, `app/dashboard/finished/**`, `components/dashboard/NavLinks.tsx`, `tests/db/review.test.ts`, `tests/e2e/06-review.spec.ts` | everything else |
| c. Step drafts | `lib/step-drafts.ts`, `lib/copy/drafts.ts`, `app/dashboard/tasks/draft-action.ts`, `components/dashboard/TaskForm.tsx`, `app/dashboard/tasks/new/page.tsx`, `app/dashboard/tasks/[id]/page.tsx`, `.env.example`, `package.json` and `package-lock.json` only if it adds the AI SDK, `tests/unit/step-drafts.test.ts`, `tests/e2e/07-drafts.spec.ts` | everything else |

Lane b needs waiting work in its tests. It makes it itself with `finishHandout` and a `submissions` insert, and does not wait for lane a.

## Worktrees and ports

| Lane | Folder | Branch | `E2E_APP_PORT` | `E2E_DB_PORT` |
|---|---|---|---|---|
| a | `~/singfrc-work/workspace-signin-lane-a` | `phase2-mark-done` | 4331 | 54341 |
| b | `~/singfrc-work/workspace-signin-lane-b` | `phase2-review` | 4332 | 54342 |
| c | `~/singfrc-work/workspace-signin-lane-c` | `phase2-step-drafts` | 4333 | 54343 |

Run the browser tests in a lane with its own ports, for example `E2E_APP_PORT=4331 E2E_DB_PORT=54341 npm run test:e2e`.

## Rules every lane keeps

- Tests first. See each new test fail before writing the code that passes it.
- Commits: author and committer `Mohan Chillara <mohan.kchill@gmail.com>` (the repo is already set up that way). No `Co-Authored-By`, no "Generated with", no AI trailer of any kind.
- No push, no remote, no deploy, no outside account, no call to an outside service.
- No real person's name anywhere. Made-up names only ("Test Member A").
- No deleting files, branches or worktrees.
- Every fixed string on a screen lives in the lane's copy file. Plain words, sentence case, no em dashes.
- The look follows the rest of the app: the classes in `app/globals.css`, the colours in `tailwind.config.ts`. No gradients, no blur, no glow.

## As merged (2026-11-19)

The three lanes were merged in the order a, b, c with no conflicts. What ended up different from the plan above:

- Lane a added `lib/submit-limits.ts` (the note and link limits, shared with the form) and returns a `problem` from `submitWork` so the screen can say why something was refused.
- Lane b added `approvals(db, ids)` to `lib/review.ts`, which tells the Finished screen who approved what.
- Lane c added one line to `scripts/e2e-server.ts` to turn the step-draft stand-in on for the test server.
- After a check of the merged result, the builder changed these shared rules:
  - The iPad on the wall is never sent a lead's comment (`forKiosk` in `lib/tasks.ts`). The comment shows on the member's own page.
  - `decide` refuses a lead's answer on their own work and returns `reason: 'own_work'`.
  - `standingFor` returns one row per hand-out, as it stands now. Earlier rounds stay in the `submissions` table.
  - `reviewQueue` rows carry `round` and `lastComment`.
  - Closing a task also closes work that is waiting on it. A change of who a task is for does not hand it out again while work on it waits. Sent-back work on a pool task can be put back.
  - A link may hold only plain visible characters after `https://`.
  - The stand-in is ignored anywhere `VERCEL` or `VERCEL_ENV` is set, not only in production.
