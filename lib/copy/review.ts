// The leads' review queue.
// Every fixed string this part of the app shows goes here. lib/copy.ts picks
// it up as copy.review; COPY.md is rebuilt from it.
export const reviewCopy = {
  navLabel: 'Review',
  title: 'Review',
  help: "Work that members sent in for a lead's check. Approve it, or send it back with a note on what to fix.",
  waitingCount: (n: number) => `${n} waiting`,
  emptyTitle: 'Nothing is waiting.',
  emptyBody: "When a member finishes a task that needs a lead's check, it shows up here.",
  sentBy: (name: string, day: string, time: string) => `Sent by ${name} on ${day} at ${time}`,
  viaKiosk: 'from the kiosk',
  viaMemberPage: 'from their own page',
  viaLead: 'by a lead',
  viaSlack: 'from Slack',
  noteLabel: 'Their note',
  noNote: 'No note.',
  linkLabel: 'Their link',
  noLink: 'No link.',
  linkUnsafe: "This link doesn't start with https://, so it isn't tappable. Copy it by hand if you trust it.",
  commentLabel: 'Comment for the member',
  commentHelp: 'Needed to send it back. The member sees it on their list.',
  commentPlaceholder: 'What should they change?',
  approve: 'Approve',
  sendBack: 'Send back',

  // Shown when an action is refused. Plain words, and what to do next.
  commentNeeded: 'Write what to change before you send it back.',
  commentLong: 'Shorten the comment to 500 characters or fewer.',
  gone: 'Someone already answered this one, or it is no longer waiting. Reload the page to see what is left.',
  notAllowed: "That didn't go through. Try again, or log in again if it keeps happening.",
  ownWork: "This is your own work, so another lead has to check it.",
  secondTry: (round: number) => `Try ${round}`,
  lastComment: 'Last time a lead wrote',

  // Finished screen, for work a lead approved.
  approvedBy: (name: string, day: string, time: string) => `Approved by ${name} on ${day} at ${time}`,
  approvedByLead: 'Approved by a lead',
  approvedChip: 'Approved',
} as const;
