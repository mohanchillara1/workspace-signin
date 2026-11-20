# To-do

The goal: at meetings, people know what to work on. Each member has an account and a QR code. They scan in at the meeting, the screen shows their tasks for the day, and the same tasks are on their account. Leads get a dashboard.

## Already built
- [x] Kiosk scan page (`/kiosk`): reads a member's QR, signs them in for the day, shows their tasks
- [x] Member page (`/m/<key>`): their QR code, today's tasks, marking work done with a note and a link
- [x] Lead dashboard (`/login`): tasks, members, attendance plus CSV export, review queue, kiosk pairing
- [x] Lead logins with invites and roles (captain / lead)
- [x] "Draft steps" with AI on the task form (off until a key is set)
- [x] Style tokens copied from singularity-frc.com (colors, Manrope / Bricolage fonts)

## Needs doing now
- [x] **Member login.** Members type their first and last name at `/login` and land on their page. Only leads and captains have passwords
- [x] **Fix the white screen after login.** `Referrer-Policy: no-referrer` made Chrome send `Origin: null`, and Next.js rejected the login
- [ ] **Style check against singularity-frc.com.** Compare each screen to the live site (header, wordmark, buttons, cards) and fix differences
- [ ] **Kiosk on a laptop and scanner.** The kiosk was built for an iPad camera. Test it with a USB scanner, which types the code like a keyboard, on a laptop screen
- [ ] **Deploy the real copy.** Host (Vercel), a Postgres database, `db:migrate`, `invite-captain`
- [ ] **Load the real roster and print QR codes** for each member

## Later
- [x] Home-screen shortcut for the member page (instead of Wallet passes, which need a paid Apple account)
- [ ] Sign-out and hours
- [ ] Copy attendance into the Google Sheet
- [ ] Slack notifications
- [ ] Photo upload (needs storage)
- [ ] Wallet passes (skipped for now: the home-screen shortcut does the job)
