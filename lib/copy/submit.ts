// Lane a: a member marking work done with a note and a link, and where each one stands.
// Every fixed string this part of the app shows goes here. lib/copy.ts picks
// it up as copy.submit; COPY.md is rebuilt from it.
export const submitCopy = {
  // The form that opens when "Done" is tapped on a task that needs a lead's check.
  formTitle: 'Tell a lead what you did',
  noteLabel: 'What did you do?',
  noteHelp: 'A sentence or two helps the lead check it. You can skip this.',
  linkLabel: 'Link to your work (optional)',
  linkHelp: 'It has to start with https://. A shared doc or folder works.',
  send: 'Send it in',
  sending: 'Sending',
  cancel: 'Never mind',

  // After it is sent.
  sentIn: "Sent in. A lead will check it. It isn't finished until they approve it.",
  kioskWaiting: "Sent to a lead to check. It isn't finished until they approve it.",

  // A task a lead sent back.
  sentBackChip: 'Sent back',
  sentBackTitle: 'A lead sent this back',
  sentBackHint: 'Fix it, then send it in again.',
  // On the iPad on the wall the lead's comment is not shown. It is on the member's own page.
  sentBackKiosk: 'Open your own page to read what to fix.',
  sentAt: (day: string, time: string) => `Sent ${day} at ${time}`,

  // The "Sent in" list on the member's page.
  listTitle: 'Sent in',
  listNone: 'Nothing sent in yet. When you finish a task that needs a lead\'s check, it shows up here.',
  waiting: "Waiting for a lead's check",
  approved: 'Approved',
  sentBack: 'Sent back',
  yourNote: 'Your note',
  yourLink: 'Your link',
  leadComment: "A lead's comment",

  // Things that go wrong, in words that say what to do.
  noteLong: 'Your note is too long. Cut it to 500 characters or fewer.',
  linkBad: 'The link has to start with https:// and have no spaces. Fix it or leave it blank.',
  linkLong: 'That link is too long. Use one that is 300 characters or fewer.',
  gone: "That didn't go through. It may not be on your list anymore. Reload the page and look again.",
  failed: "That didn't send. Try again.",
} as const;
