// Checking a task off from Slack, and the Slack id a lead records for a member.
// Every fixed string this part of the app shows or sends goes here. lib/copy.ts
// picks it up as copy.slack; COPY.md is rebuilt from it.
export const slackCopy = {
  // What the /done command answers. Only the person who typed it sees these.
  notLinked: "This Slack account isn't linked to a member yet. Ask a lead to add your Slack member ID on the Members screen.",
  nothingOpen: 'You have nothing open right now.',
  listTitle: (count: number) => `Your open tasks (${count}):`,
  groupYours: 'Yours',
  groupSubteam: 'Your subteam',
  listHelp: 'To finish one, type /done and the code in front of it. If a lead checks that task, add a few words after the code to say what you did.',
  poolHint: 'Tasks that are up for grabs are not on this list. Take one on the kiosk or on your page first.',
  usage: 'Type /done to see your tasks. To finish one, type /done and its code from that list.',
  noSuchCode: (code: string) => `There is no task with the code ${code} on your list. Type /done to see your tasks.`,
  finished: (title: string) => `Finished: ${title}`,
  waiting: (title: string) => `Sent to a lead to check: ${title}. It isn't finished until they approve it.`,
  gone: 'That task is no longer on your list. Type /done to see your tasks again.',
  noteLong: 'Those words are too long. Shorten them and try again. Nothing was changed.',
  tooMany: 'Slow down. Wait a minute and try again.',
  failed: 'Something went wrong and nothing was changed. Try again in a minute.',

  // The Members screen.
  idLabel: 'Slack member ID',
  idHelp: 'In Slack, open their profile and look for the option to copy their member ID. It starts with U or W. Leave it empty to unlink.',
  idSave: 'Save Slack ID',
  idSaved: 'Slack member ID saved.',
  idCleared: 'Slack member ID removed.',
  idBadShape: "That doesn't look like a Slack member ID. It starts with U or W and has capital letters and numbers, like U123ABC456.",
  idTaken: 'Another member already has that Slack member ID.',
  linkedChip: 'In Slack',
} as const;
