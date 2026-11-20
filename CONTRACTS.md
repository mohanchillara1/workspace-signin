# Phase 2: how the pieces fit

Developer notes for the three things phase 2 added. Read `README.md` first for how to run the app and where things are.

1. **Mark done.** A member marks a task done with a short note and an optional link. Their page shows where each one stands: waiting, approved, or sent back with the lead's comment.
2. **Review queue.** A lead approves, or sends back with a comment. The member sends it again. The task's "needs a lead's check" switch decides whether a finished task goes through the queue at all.
3. **Step drafts.** "Draft steps" on the task form asks an AI service for a short list of steps. The lead edits them. Nothing is published until the lead saves. It is built and tested against a stand-in: no real call has been made and no key exists. With no key set, the button is not there.

AI never reads a submission and never judges work. Photo upload is not built.

## The data

`lib/db/schema.ts`, migration `drizzle/0002_*.sql`:

- A hand-out (`assignments`) is in one of these states: `open`, `claimed`, `sent_back` (on someone's list), `submitted` (waiting for a lead), `done` and `approved` (finished), `closed`.
- `submissions` has one row each time a member sends work in: `assignmentId`, `memberId`, `note`, `link`, `via` (`kiosk` or `member_page`), `createdAt`. The lead's answer is on the same row and is empty while it waits: `decision` (`approved` or `sent_back`), `comment`, `reviewedById`, `reviewedAt`.

## The two places a hand-out changes hands

Both are in `lib/tasks.ts`, and both run inside a transaction the caller opens.

```ts
// A member finishes a hand-out. The only place that happens. With check: true,
// a task that needs a check becomes 'submitted'; otherwise 'done'.
finishHandout(tx, { taskId, assignmentId?, memberId, via, today, check })
  : Promise<{ ok: boolean; state?: 'done' | 'submitted'; assignmentId?: string }>

// A lead's answer on waiting work: 'submitted' becomes 'approved' or 'sent_back'.
// The caller writes who decided and the comment onto the submissions row.
settleReview(tx, { assignmentId, decision: 'approved' | 'sent_back' })
  : Promise<{ ok: boolean; taskId?: string }>
```

`openFor(db, memberId, today)` lists a member's hand-outs, sent-back work included, with the lead's comment. `forKiosk(handouts)` takes the comment off before anything is sent to the kiosk.

## What each part offers

| File | Function | What it does |
|---|---|---|
| `lib/submit.ts` | `submitWork(db, { taskId, assignmentId?, memberId, note, link, via, today })` returns `{ ok, state?, problem? }` | One transaction: `finishHandout` with `check: true`, and when the state is `submitted`, one `submissions` row. The note is trimmed, may be empty, and is at most 500 characters. The link is empty, or starts with `https://`, holds only plain visible characters and is at most 300 characters. Anything else is refused before anything is written, and `problem` says why. |
| `lib/submit.ts` | `standingFor(db, memberId)` | Where each piece of a member's sent-in work stands now: one row per hand-out, newest first, at most 20. Earlier rounds stay in the `submissions` table. |
| `lib/review.ts` | `reviewQueue(db)` | Work waiting for a lead, oldest first. Each row has the member's whole name, the note, the link, how it was sent, `round` and `lastComment`. |
| `lib/review.ts` | `decide(db, { assignmentId, decision, comment, actorId })` returns `{ ok, reason? }` | One transaction. The actor must be an active lead or captain. A send-back needs a comment (at most 500 characters). A lead's answer on their own work is refused with `reason: 'own_work'`. |
| `lib/review.ts` | `approvals(db, assignmentIds)` | Who approved what, for the Finished screen. |
| `lib/step-drafts.ts` | `draftsAvailable()` | True when `ANTHROPIC_API_KEY` is set, or when the test stand-in is on. |
| `lib/step-drafts.ts` | `draftSteps({ title, description, subteam }, client?)` | The drafted steps, each at most 200 characters. It sends the title, the description and the subteam name only: never a member's name or anything a member sent in. |

The limits live in `lib/submit-limits.ts` so the form and the server share them.

## Screens and routes

- The member page `/m/[key]` and the kiosk's `POST /api/kiosk/done` both call `submitWork`. On the kiosk "Done" is two taps with no note. The member page asks for the note and the link when the task needs a check, and has a "Sent in" list from `standingFor`.
- `/dashboard/review` is the leads' queue. Finished stays the list of finished work.
- `draftStepsAction` in `app/dashboard/tasks/draft-action.ts` is behind the "Draft steps" button. The page passes `canDraft={draftsAvailable()}` to the form.

## Rules worth knowing before you change this

- The iPad on the wall is never sent a lead's comment. It shows on the member's own page.
- Closing a task also closes work that is waiting on it.
- Changing who a task is for does not hand it out again while work on it waits.
- Sent-back work on an up-for-grabs task can be put back.
- The step-draft stand-in (`STEP_DRAFTS_STAND_IN=1`) is for test servers. It is ignored anywhere `VERCEL` or `VERCEL_ENV` is set.
- Every fixed string on a screen lives in `lib/copy.ts` or, for these three parts, in `lib/copy/submit.ts`, `lib/copy/review.ts` and `lib/copy/drafts.ts`. `npm run copy:md` rebuilds `COPY.md`, and a test fails when the two disagree.
