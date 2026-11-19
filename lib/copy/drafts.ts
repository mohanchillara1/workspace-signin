// Lane c: the "Draft steps" button on the task form.
// Every fixed string this part of the app shows goes here. lib/copy.ts picks
// it up as copy.drafts; COPY.md is rebuilt from it.
export const draftsCopy = {
  button: 'Draft steps',
  working: 'Drafting',
  notice: 'A computer drafts these from the title and detail. Read every step and fix it before you publish.',
  replaceAsk: 'The Steps box already has text. Replace it with a new draft?',
  replaceYes: 'Replace it',
  replaceNo: 'Keep my steps',
  filled: 'Drafted. Read each step and fix what is wrong. Nothing is saved yet.',
  changedWhileWaiting: 'You changed the Steps box while the draft was coming, so it was left alone. Press Draft steps to try again.',
  needTitle: 'Fill in "What needs doing" first, so the draft knows what the task is',
  empty: "The draft came back with no steps. Try again, or type the steps yourself",
  failed: "Couldn't draft steps right now. Try again in a minute, or type them yourself",
  slow: "The draft took too long. Try again in a minute, or type the steps yourself",
  unavailable: 'Drafting is not turned on. Type the steps yourself',
  tooMany: 'That was a lot of drafts. Wait a minute, then try again',
} as const;
