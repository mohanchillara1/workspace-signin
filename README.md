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

Members log in on `/login` with their first and last name. Leads and captains log in on `/admin`; only they have a password. The members' page has no link to it. A hosted copy never gets the captain's password.

- Lead dashboard: `/admin`, as `testcaptain`.
- A member: `/login`, with their first and last name. Two people with the same name can't log in that way; a lead copies them their page link from Members instead.
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
| `lib/members.ts` | Members, scan codes, page links, roster paste, subteams. |
| `lib/subteams.ts` | Which subteams a person is in, and who a task for a subteam goes to. |
| `lib/inventory.ts` | The inventory: items, counts, photos, the starter list, who changed a count. |
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

The Home Screen icons are drawn from the team logo, `public/team-logo.png`, by `npx tsx scripts/make-icons.ts`.

## A new database (later)

```bash
DATABASE_URL=... npm run db:migrate
DATABASE_URL=... npm run invite-captain -- "First" "Last"
```

The first command also stores an 8-second limit on any one statement in the database itself, as a default of the role it connects as. The app asks for that limit each time it connects, but a host's proxy can drop the request without an error (Neon's does), and the database then runs with no limit. To ask a database what it enforces:

```bash
DATABASE_URL=... npm run db:limit              # read-only; exits 1 when it is not 8 seconds
DATABASE_URL=... npm run db:limit -- --slow    # also times a 9-second statement
```

The `invite-captain` command prints a one-time path where the first captain sets a password. If that person is already on the roster, they become the captain and keep their own row. Every other lead gets an invite link from a captain, on the Members screen.

To give admins a password yourself instead of sending invite links, add them to the roster first (Members, then Paste a roster), then for each one:

```bash
DATABASE_URL=... npm run set-login -- "First" "Last" --role captain --login first
```

`--role` is `lead` or `captain`. It asks for the password (5 characters or more), so it never lands in a file or your shell history. Running it again changes the password.

### Attendance from the old sheet

Save the sheet as CSV. The first row is `name` and then one day in each column, written like `2026-09-07`. Each row after it is a person, with `TRUE` or `FALSE` under each day. Then:

```bash
DATABASE_URL=... npm run import-attendance -- path/to/attendance.csv --hosted
```

It adds anyone in the file who is not on the roster and one attendance row for each `TRUE`. The Attendance screen shows those rows as "from the attendance sheet" with no scan time, because the sheet has none. Each person's own count then runs from the file's first day. Running it again adds nothing. It prints counts, never names. The file has real names in it, so keep it out of this repo.

### Subteams

A person can be in any number of subteams, or none. A subteam can be part of one other subteam (Assembly is part of Mech + Electrical), one level deep. A task for a subteam goes to everyone in it and to everyone in a subteam that is part of it, once each. Leads set all of this on the Members screen.

To set many people at once, write a file with one person per line, the name and then their subteams with semicolons between them:

```
name,subteams
First Last,Assembly; CAD
Another Person,Media
```

```bash
DATABASE_URL=... npm run set-subteams -- path/to/subteams.csv --hosted
```

Each person in the file ends up in exactly the subteams on their line. People who are not in the file are left as they are. It adds nobody and makes no subteam: a name that is not on the roster, or a subteam that does not exist yet, stops it before anything changes, and it says which lines. It prints counts and subteam names, never a person's name. Keep the file out of this repo.

### Inventory

What the team has on its shelves: each item has a group, a count and a picture. A count can be empty, which shows as "Not counted yet".

- Leads and captains keep the list on the Inventory screen: add an item, write down a count, add a photo, or press "We don't have this". That sets the item aside; it is not deleted and can be brought back.
- A photo is shrunk in the browser to 480 pixels on its long side before it is sent, and kept in the database. Until an item has one it shows a small drawing for its group.
- Members see the inventory from their own page once a captain opens it to them. A member can add to a count or take from it, and nothing else.
- Every change of a count is written down with who made it and when. Leads read that under "Who changed what".

To start from a guess instead of an empty page:

```bash
DATABASE_URL=... npm run inventory-starter -- --hosted
```

It adds the starter list in `lib/inventory-starter.ts` with every count empty, and only the items that are not on the list yet.

## A test copy on a host

A copy that holds made-up names only is run with `TEST_COPY=1`. The dashboard and the kiosk then show a "Test copy" tag, so nobody types a real roster into it. `npm run seed` fills a hosted database only when that switch is on, and prints no password there: a captain gets in with `npm run invite-captain -- --login testcaptain`. `scripts/live-check.ts` checks a hosted copy from the outside. Send it few requests: a burst at private-looking paths makes a host treat you as a scanner.

## Wallet passes (off until a key is set)

A member's page can show "Add to Apple Wallet" and "Add to Google Wallet". The pass holds their sign-in code as a QR code, their first name and the team's name. A signing service, WalletWallet, makes it, so the team needs no Apple developer account.

- It is off, and the buttons are hidden, until `WALLETWALLET_API_KEY` is set on the host. No key exists yet and no request has ever been sent to the service: the code follows its public documentation and has only run against a built-in stand-in.
- When it is on, each tap sends that member's sign-in code and first name to WalletWallet. Nothing else about them leaves. The Members screen says this to leads, with the free plan's limits.
- A pass is not updated after it is made. A new QR code for a member stops their old pass; they add a new one.
- `WALLET_STAND_IN=1` makes made-up passes on a developer's machine and in the tests. It wins over a key there, so a test run never spends a real pass, and it is ignored on the real host.

## Checking a task off from Slack (off until a secret is set)

A member types `/done` in the team's Slack to see their own and their subteam's open tasks, each with a short code, and `/done` with a code to finish that one. The code belongs to the task, so it still means the same task after the list has changed. A task that needs a lead's check goes to the leads' queue, the same as pressing Done on the kiosk. Up-for-grabs tasks are not listed: a member takes one on the kiosk or on their page first.

- It is off, and `/api/slack/command` refuses every request, until `SLACK_SIGNING_SECRET` is set. Every request must carry Slack's signature. No Slack app has been installed and no request from Slack has ever reached this code: it follows Slack's public documentation and has only been tested with requests signed by the tests.
- Slack knows people by a member ID, not by name. A lead records each member's Slack member ID under Edit on the Members screen. Until then `/done` tells that person to ask a lead.
- An admin installs the app from `slack/manifest.yaml`. The steps are in `slack/README.md`.

## Not built yet

Photo upload (it needs storage on a host), a copy into the Google Sheet, sign-out and hours.
