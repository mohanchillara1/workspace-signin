import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db/client';
import { copy } from './copy';
import { sha256 } from './ids';
import { memberBySlackUserId, SLACK_ID_PATTERN } from './members';
import { hit } from './rate-limit';
import { NOTE_MAX, submitWork } from './submit';
import { openFor, type Handout } from './tasks';

// Built to Slack's pages, read 2026-11-19:
//   https://docs.slack.dev/authentication/verifying-requests-from-slack
//   https://docs.slack.dev/interactivity/implementing-slash-commands

/** True when a signing secret is set. Without one the Slack address refuses everything. */
export function slackAvailable(): boolean {
  return (process.env.SLACK_SIGNING_SECRET ?? '').trim() !== '';
}

export { SLACK_ID_PATTERN };

// "check to make sure that the request occurred recently ... not differ from
// local time by more than five minutes."
const MAX_AGE_SECONDS = 60 * 5;

/**
 * Checks that a request really came from Slack, the way the docs say: the
 * signature is "v0=" plus the hex HMAC-SHA256, keyed with the signing secret,
 * of "v0:" + timestamp + ":" + the raw body. The compare takes the same time
 * wherever the two differ. Anything missing or odd is a no.
 */
export function verifySlackRequest(input: {
  signingSecret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  now: Date;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody, now } = input;
  if (!signingSecret || typeof timestamp !== 'string' || typeof signature !== 'string') return false;
  if (!/^\d{1,15}$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  const mine = 'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  const a = Buffer.from(mine);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Slack's message text treats & < > as markup; a title must not become a mention or a link. */
const escapeForSlack = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CODE_MIN = 4;
const CODE_MAX = 12;

/**
 * A short code for each hand-out, made from the hand-out's own id. A position
 * in the list moves when a task is added, finished or approved; the code does
 * not, so a command can never land on a different task than the one the member
 * was looking at. Longer only when two on one list would share a code.
 */
export function taskCodes(handouts: Pick<Handout, 'key'>[]): string[] {
  const full = handouts.map((handout) => sha256(handout.key));
  for (let length = CODE_MIN; length < CODE_MAX; length++) {
    const codes = full.map((hash) => hash.slice(0, length));
    if (new Set(codes).size === codes.length) return codes;
  }
  return full.map((hash) => hash.slice(0, CODE_MAX));
}

/**
 * What /done answers. Task titles are the only thing taken from the database
 * besides the member's own hand-outs: no lead comment, no note, no other
 * member's name.
 *
 * It lists and finishes what the Done button does on the kiosk: the member's
 * own tasks and their subteam's. An up-for-grabs task has to be taken first,
 * on the kiosk or the member's page, so a slip here cannot take one.
 */
export async function handleCommand(
  db: Db,
  input: { slackUserId: string; text: string; today: string; now: Date },
): Promise<{ text: string }> {
  const member = await memberBySlackUserId(db, input.slackUserId);
  if (!member) return { text: copy.slack.notLinked };

  const all = await openFor(db, member.id, input.today);
  const handouts = all.filter((handout) => handout.group !== 'pool');
  const codes = taskCodes(handouts);
  const poolHint = all.length > handouts.length ? ['', copy.slack.poolHint] : [];
  const typed = String(input.text ?? '').trim();

  if (typed === '') {
    if (handouts.length === 0) return { text: [copy.slack.nothingOpen, ...poolHint].join('\n') };
    const lines: string[] = [];
    for (const [group, heading] of [['yours', copy.slack.groupYours], ['subteam', copy.slack.groupSubteam]] as const) {
      const rows = handouts.flatMap((handout, i) => (handout.group === group ? [`\`${codes[i]}\`  ${escapeForSlack(handout.title)}`] : []));
      if (rows.length > 0) lines.push(heading, ...rows);
    }
    return { text: [copy.slack.listTitle(handouts.length), ...lines, '', copy.slack.listHelp, ...poolHint].join('\n') };
  }

  const match = /^([0-9a-f]{4,12})(?:\s+([\s\S]*))?$/i.exec(typed);
  if (!match) return { text: copy.slack.usage };
  const code = match[1].toLowerCase();
  const handout = handouts[codes.indexOf(code)];
  if (!handout) return { text: copy.slack.noSuchCode(code) };

  const note = (match[2] ?? '').trim();
  if ([...note].length > NOTE_MAX) return { text: copy.slack.noteLong };
  const result = await submitWork(db, {
    taskId: handout.taskId,
    assignmentId: handout.assignmentId,
    memberId: member.id,
    note,
    link: '',
    via: 'slack',
    today: input.today,
  });
  if (!result.ok || !result.state) return { text: result.problem === 'note_long' ? copy.slack.noteLong : copy.slack.gone };
  const title = escapeForSlack(handout.title);
  return { text: result.state === 'submitted' ? copy.slack.waiting(title) : copy.slack.finished(title) };
}

const LIMIT = 20;
const WINDOW_SECONDS = 60;

/**
 * What the route calls once the signature has passed: each Slack user is
 * limited, and anything that goes wrong is answered in plain words.
 */
export async function answerSlackCommand(
  db: Db,
  input: { slackUserId: string; text: string; today: string; now: Date },
): Promise<{ text: string }> {
  try {
    const { allowed } = await hit(db, { key: `slack:${input.slackUserId.slice(0, 40)}`, limit: LIMIT, windowSeconds: WINDOW_SECONDS, now: input.now });
    if (!allowed) return { text: copy.slack.tooMany };
    return await handleCommand(db, input);
  } catch (error) {
    console.error('A Slack command failed.', error);
    return { text: copy.slack.failed };
  }
}
