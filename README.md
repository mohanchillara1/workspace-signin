# Workspace sign-in and tasks

An iPad on the workspace wall reads a member's QR code. The scan signs them in for the day and shows what they should work on. Leads load the tasks from a dashboard, see who is here, and export attendance.

Phase 1 is sign-in and tasks. Phase 2 adds marking work done with a note and a link, a review queue where a lead approves it or sends it back, and a "Draft steps" button on the task form. This repository is connected to a Vercel project. Every push to `main` is deployed there by itself, and every pushed branch gets a preview build. That deployment has no database yet, so the pages that need one answer with an error.

To work on it, read `CONTRIBUTING.md`.

## Run it

You need Node 22. Nothing else: the database is a real Postgres that npm downloads and the app starts by itself. It has been run on Linux (Ubuntu under WSL2) and on macOS (with Node 24 too).

```bash
npm install
cp .env.example .env.local      # then put 32+ random characters in SESSION_SECRET
npm run db                      # terminal 1: the local Postgres, leave it open
npm run seed                    # terminal 2, once: made-up people, tasks and check-ins
npm run dev                     # http://127.0.0.1:4320
```

Test logins on your machine (the seed makes the same ones for everyone, with made-up names):

| Who | Login name | Password | Opens |
|---|---|---|---|
| Lead (captain) | `testcaptain` | `test-captain-pass` | The dashboard |
| Member | First name `Test`, last name `Member A` (no password) | | Their own page: QR code and tasks |

Both are on `/login`. Members type their first and last name; only leads and captains have a password. A hosted copy never gets the captain's password.

- Lead dashboard: `/login`, as `testcaptain`.
- A member: `/login`, under "Members", with their first and last name. Two people with the same name can't log in that way; a lead copies them their page link from Members instead.
- Kiosk: log in, open Kiosk, choose "Make this the kiosk". The scan page is `/kiosk`.
- A member's page: the seed prints one link. Leads copy the rest from Members.

A laptop's camera works for trying the kiosk. Browsers only give a page the camera on `https` or on `localhost`/`127.0.0.1`.

## Check it

```bash
npm test             # the rules, against a throwaway Postgres (about 5 seconds)
npm run test:e2e     # builds the app, then drives it in Chrome (about a minute)
npm run screenshots -- some/folder   # after a build: every screen, with checks
npm run review -- 4320 signin        # after a build: a copy to click through, with the test feed on
```

The browser tests use the system Chrome at `/usr/bin/google-chrome`. If yours is somewhere else, set `CHROME` to its path. On a Mac: `CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e`.

One browser test plays a video of a QR code as Chrome's camera, so the camera and the decoder do the reading. The rest feed the kiosk a code through a test-only door (`KIOSK_TEST_FEED=1`), which the app refuses in production.

## Where things are

| Path | What it holds |
|---|---|
| `lib/scan.ts` | What happens on a scan. Attendance is written first; tasks load in their own `try`. |
| `lib/attendance.ts` | One row per member per Central day, by-hand edits, meeting days, counts. |
| `lib/tasks.ts` | Tasks and their hand-outs: person, subteam, pool, standing. The one place a hand-out is finished (`finishHandout`) and the one place a lead's answer moves it (`settleReview`). |
| `lib/submit.ts` | A member sends work in, with a note and a link; where each piece stands. |
| `lib/review.ts` | The leads' review queue: approve, or send back with a comment. |
| `lib/step-drafts.ts` | "Draft steps": the request to the AI service, the stand-in, and the cleaning of what comes back. |
| `lib/members.ts` | Members, scan codes, page links, roster paste. |
| `lib/auth/` | Lead logins: invites, passwords, the session cookie. |
| `lib/kiosk.ts` | Pairing a device as the kiosk. |
| `lib/scanner/` | The QR decoder and the camera, behind one small interface. |
| `lib/copy.ts` | Every fixed string on a screen. `COPY.md` is built from it. |
| `lib/db/schema.ts`, `drizzle/` | The tables and their migrations. |
| `app/` | Pages and routes. They are thin: the rules are in `lib/`. |
| `CONTRACTS.md` | Developer notes on phase 2: the states, the functions and the rules between them. |
| `scripts/` | The local database, the seed, the first captain's invite, screenshots, and `live-check.ts` for a hosted copy. |
| `phase0-test/` | The throwaway camera test from before this app. Not part of it. |

## Rules this code keeps

- A member's name is in the database only. Seeds, tests and screenshots use made-up names.
- The kiosk and the member page show a first name and a last initial. Whole names appear only behind a lead's login.
- A "day" is the calendar date in Central time, worked out on the server.
- Every page is `noindex`.
- No email, phone number or birthday is stored.
- Nothing judges a member's work but a lead. The one place AI can be used is "Draft steps" on the task form, and only when a key is set: it is sent the task's title, detail and subteam name, never a member or anything a member sent in, and a lead edits what comes back before anything is published. With no key the button is not there. No key exists yet and no real call has ever been made; the tests use a stand-in.
- A lead's comment on someone's work shows on that member's own page, never on the iPad on the wall.
- A lead cannot approve their own work. Another lead does.
- A lead looks after members. Only a captain can change a lead or a captain, change roles, or make invite links.
- Logging out ends that session on the server. Deactivating or demoting a lead, or sending them a new invite, ends all of theirs.
- "Done" takes two taps, because only a lead can bring a finished task back.

## Setting up the iPad

The steps are on the leads' Kiosk page, and those are the ones to follow. In short: open `/kiosk` in Safari on the iPad, add it to the Home Screen, open that icon, log in there and choose "Make this the kiosk", allow the camera, set Auto-Lock to Never, and lock the iPad to the app with Guided Access. Pair it inside the Home Screen app: it keeps its own logins, separate from Safari's.

What the kiosk does by itself:

- It asks the browser to keep the screen on (the Screen Wake Lock API, where the browser has it).
- It dims after `KIOSK_DIM_MINUTES` with no scan and no touch (60 unless set; 0 turns dimming off). The camera keeps reading, so a code held up to it wakes the screen.
- It starts the camera again if the camera is taken away.
- It says so when the connection drops, and carries on when it is back.
- It reloads itself when the site has a newer build and nobody is using the screen. It asks the server first, so it never reloads into a browser error page.
- If the scan screen itself breaks, it shows a short message and reloads.

Only a real iPad can prove the following, and none has been tried yet:

- that the Home Screen app opens full screen and keeps its pairing between launches;
- that iPadOS lets a Home Screen app keep the screen on;
- whether the iPad asks for the camera again after a reload. If it does, the reload after an update leaves the kiosk waiting for someone to tap Allow;
- how the dimmed screen looks on the iPad's display.

The Home Screen icons are drawn from `app/icon.svg` by `npx tsx scripts/make-icons.ts`.

## A new database (later)

```bash
DATABASE_URL=... npm run db:migrate
DATABASE_URL=... npm run invite-captain -- "First" "Last"
```

The second command prints a one-time path where the first captain sets a password. Every other lead gets an invite link from a captain, on the Members screen.

## A test copy on a host

A copy that holds made-up names only is run with `TEST_COPY=1`. The dashboard and the kiosk then show a "Test copy" tag, so nobody types a real roster into it. `npm run seed` fills a hosted database only when that switch is on, and prints no password there: a captain gets in with `npm run invite-captain -- --login testcaptain`. `scripts/live-check.ts` checks a hosted copy from the outside. Send it few requests: a burst at private-looking paths makes a host treat you as a scanner.

## Not built yet

Photo upload (it needs storage on a host), Wallet passes (members use the home-screen shortcut on their page instead), Slack, a copy into the Google Sheet, sign-out and hours.
