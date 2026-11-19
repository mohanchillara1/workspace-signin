# Workspace sign-in and tasks

An iPad on the workspace wall reads a member's QR code. The scan signs them in for the day and shows what they should work on. Leads load the tasks from a dashboard, see who is here, and export attendance.

This is phase 1: sign-in and tasks. It runs on this machine only. Nothing here is deployed.

## Run it

You need Node 22. Nothing else: the database is a real Postgres that npm downloads and the app starts by itself.

```bash
npm install
cp .env.example .env.local      # then put 32+ random characters in SESSION_SECRET
npm run db                      # terminal 1: the local Postgres, leave it open
npm run seed                    # terminal 2, once: made-up people and tasks; prints a lead login
npm run dev                     # http://127.0.0.1:4320
```

- Lead dashboard: `/login`, with the login the seed printed.
- Kiosk: log in, open Kiosk, choose "Make this the kiosk". The scan page is `/kiosk`.
- A member's page: the seed prints one link. Leads copy the rest from Members.

A laptop's camera works for trying the kiosk. Browsers only give a page the camera on `https` or on `localhost`/`127.0.0.1`.

## Check it

```bash
npm test             # the rules, against a throwaway Postgres (about 5 seconds)
npm run test:e2e     # builds the app, then drives it in Chrome (about a minute)
npm run screenshots -- some/folder   # after a build: every screen, with checks
```

The browser tests use the system Chrome at `/usr/bin/google-chrome`. Set `CHROME` to use another.

One browser test plays a video of a QR code as Chrome's camera, so the camera and the decoder do the reading. The rest feed the kiosk a code through a test-only door (`KIOSK_TEST_FEED=1`), which the app refuses in production.

## Where things are

| Path | What it holds |
|---|---|
| `lib/scan.ts` | What happens on a scan. Attendance is written first; tasks load in their own `try`. |
| `lib/attendance.ts` | One row per member per Central day, by-hand edits, meeting days, counts. |
| `lib/tasks.ts` | Tasks and their hand-outs: person, subteam, pool, standing. |
| `lib/members.ts` | Members, scan codes, page links, roster paste. |
| `lib/auth/` | Lead logins: invites, passwords, the session cookie. |
| `lib/kiosk.ts` | Pairing a device as the kiosk. |
| `lib/scanner/` | The QR decoder and the camera, behind one small interface. |
| `lib/copy.ts` | Every fixed string on a screen. `COPY.md` is built from it. |
| `lib/db/schema.ts`, `drizzle/` | The tables and their migrations. |
| `app/` | Pages and routes. They are thin: the rules are in `lib/`. |
| `phase0-test/` | The throwaway camera test from before this app. Not part of it. |

## Rules this code keeps

- A member's name is in the database only. Seeds, tests and screenshots use made-up names.
- The kiosk and the member page show a first name and a last initial. Whole names appear only behind a lead's login.
- A "day" is the calendar date in Central time, worked out on the server.
- Every page is `noindex`.
- No email, phone number or birthday is stored.
- No AI is called anywhere, and nothing judges a member's work.

## Setting up the iPad (later, when it is deployed)

1. Open the site in Safari and add it to the Home Screen.
2. Open it from the Home Screen, log in as a lead, open Kiosk, and choose "Make this the kiosk". Pair it inside the Home Screen app: it keeps its own cookies, separate from Safari's.
3. Turn on Guided Access so it stays on the scan page.
4. Set Auto-Lock to Never and keep it on the charger.

## A new database (later)

```bash
DATABASE_URL=... npm run db:migrate
DATABASE_URL=... npm run invite-captain -- "First" "Last"
```

The second command prints a one-time path where the first captain sets a password. Every other lead gets an invite link from a captain, on the Members screen.

## Not built yet

Marking work done with a note or photo, a lead's approve or send back, step drafts, Wallet passes, Slack, a copy into the Google Sheet, sign-out and hours.
