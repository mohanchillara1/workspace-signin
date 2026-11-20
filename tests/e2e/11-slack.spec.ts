import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { assignments, members, submissions } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { createTask, publishTask } from '@/lib/tasks';
import { captainId, closeDb, db, logIn, state, watchConsole } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });
test.afterAll(closeDb);

// The same secret scripts/e2e-server.ts gives the test server. Not a real one.
const SECRET = 'test-signing-secret-not-a-real-one';
const URL_PATH = '/api/slack/command';

function signed(fields: Record<string, string>, over: { secret?: string; timestamp?: number; body?: string } = {}) {
  const body = over.body ?? new URLSearchParams({ command: '/done', ...fields }).toString();
  const timestamp = String(over.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = 'v0=' + createHmac('sha256', over.secret ?? SECRET).update(`v0:${timestamp}:${body}`).digest('hex');
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
    data: body,
  };
}

test('a lead records a Slack member id on the Members screen, and a taken or badly shaped id is refused in plain words', async ({ page }) => {
  const errors = watchConsole(page);
  await db(); // make sure the handle is open
  await addMember(db(), { firstName: 'Slack', lastName: 'Alpha' }, null);
  await addMember(db(), { firstName: 'Slack', lastName: 'Beta' }, null);
  await logIn(page);
  await page.goto('/dashboard/members');
  const alpha = page.locator('[data-member-name="Slack Alpha"]');
  await alpha.getByText(copy.members.edit).click();
  await expect(alpha.getByText(copy.slack.idHelp)).toBeVisible();
  await alpha.getByLabel(copy.slack.idLabel).fill('U0E2EALPHA');
  await alpha.getByRole('button', { name: copy.slack.idSave }).click();
  await expect(page.getByText(copy.slack.idSaved)).toBeVisible();
  await expect(page.locator('[data-member-name="Slack Alpha"]')).toContainText(copy.slack.linkedChip);
  const [row] = await db().select().from(members).where(eq(members.firstName, 'Slack'));
  expect((await db().select().from(members).where(eq(members.slackUserId, 'U0E2EALPHA')))).toHaveLength(1);
  expect(row).toBeTruthy();

  const beta = page.locator('[data-member-name="Slack Beta"]');
  await beta.getByText(copy.members.edit).click();
  await beta.getByLabel(copy.slack.idLabel).fill('U0E2EALPHA');
  await beta.getByRole('button', { name: copy.slack.idSave }).click();
  await expect(page.getByText(copy.slack.idTaken)).toBeVisible();

  await page.locator('[data-member-name="Slack Beta"]').getByText(copy.members.edit).click();
  await page.locator('[data-member-name="Slack Beta"]').getByLabel(copy.slack.idLabel).fill('not an id');
  await page.locator('[data-member-name="Slack Beta"]').getByRole('button', { name: copy.slack.idSave }).click();
  await expect(page.getByText(copy.slack.idBadShape)).toBeVisible();

  // Clearing it.
  await page.locator('[data-member-name="Slack Alpha"]').getByText(copy.members.edit).click();
  await page.locator('[data-member-name="Slack Alpha"]').getByLabel(copy.slack.idLabel).fill('');
  await page.locator('[data-member-name="Slack Alpha"]').getByRole('button', { name: copy.slack.idSave }).click();
  await expect(page.getByText(copy.slack.idCleared)).toBeVisible();
  expect(await db().select().from(members).where(eq(members.slackUserId, 'U0E2EALPHA'))).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('the Slack address answers a request signed with the test secret, only to the person, and finishes a task', async ({ request }) => {
  const member = await addMember(db(), { firstName: 'Slack', lastName: 'Gamma' }, null);
  await db().update(members).set({ slackUserId: 'U0E2EGAMMA' }).where(eq(members.id, member.id));
  const actor = await captainId();
  const make = async (title: string, needsCheck: boolean) => {
    const task = await createTask(db(), { title, audience: 'person', memberIds: [member.id], needsCheck }, actor);
    await publishTask(db(), task.id, actor);
    return task;
  };
  const plain = await make('E2E plain task', false);
  const checked = await make('E2E checked task', true);

  const list = await request.post(URL_PATH, signed({ user_id: 'U0E2EGAMMA', text: '' }));
  expect(list.status()).toBe(200);
  expect(list.headers()['content-type']).toContain('application/json');
  const listed = await list.json();
  expect(listed.response_type).toBe('ephemeral');
  expect(listed.text).toContain('1. E2E plain task');
  expect(listed.text).toContain('2. E2E checked task');

  const waiting = await (await request.post(URL_PATH, signed({ user_id: 'U0E2EGAMMA', text: '2 cut it out' }))).json();
  expect(waiting).toEqual({ response_type: 'ephemeral', text: copy.slack.waiting('E2E checked task') });
  const [sub] = await db().select().from(submissions).where(eq(submissions.memberId, member.id));
  expect(sub).toMatchObject({ via: 'slack', note: 'cut it out' });
  const [checkedRow] = await db().select().from(assignments).where(eq(assignments.taskId, checked.id));
  expect(checkedRow.state).toBe('submitted');

  const done = await (await request.post(URL_PATH, signed({ user_id: 'U0E2EGAMMA', text: '1' }))).json();
  expect(done).toEqual({ response_type: 'ephemeral', text: copy.slack.finished('E2E plain task') });
  const [plainRow] = await db().select().from(assignments).where(eq(assignments.taskId, plain.id));
  expect(plainRow).toMatchObject({ state: 'done', doneVia: 'slack' });

  const unknown = await (await request.post(URL_PATH, signed({ user_id: 'U0NOTLINKD', text: '' }))).json();
  expect(unknown).toEqual({ response_type: 'ephemeral', text: copy.slack.notLinked });
});

test('the Slack address refuses an unsigned, wrongly signed, tampered or old request, and changes nothing', async ({ request }) => {
  const member = await addMember(db(), { firstName: 'Slack', lastName: 'Delta' }, null);
  await db().update(members).set({ slackUserId: 'U0E2EDELTA' }).where(eq(members.id, member.id));
  const actor = await captainId();
  const task = await createTask(db(), { title: 'E2E untouched', audience: 'person', memberIds: [member.id], needsCheck: false }, actor);
  await publishTask(db(), task.id, actor);

  const fields = { user_id: 'U0E2EDELTA', text: '1' };
  const good = signed(fields);
  const tampered = { ...good, data: good.data.replace('text=1', 'text=2') };
  const attempts = [
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: good.data },
    signed(fields, { secret: 'a-different-secret' }),
    tampered,
    signed(fields, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
    { headers: { ...good.headers, 'x-slack-signature': 'v0=' }, data: good.data },
  ];
  for (const attempt of attempts) {
    const response = await request.post(URL_PATH, attempt);
    expect(response.status()).toBe(401);
    expect(await response.text()).toBe('');
  }
  const [row] = await db().select().from(assignments).where(eq(assignments.taskId, task.id));
  expect(row.state).toBe('open');
  // A request that was never signed does not reach the rate limit either.
  const get = await request.get(URL_PATH);
  expect(get.status()).toBe(405);
  expect(state().baseUrl).toContain('127.0.0.1');
});

test('the Slack address limits one Slack user and not another', async ({ request }) => {
  let limited = 0;
  for (let i = 0; i < 24; i++) {
    const body = await (await request.post(URL_PATH, signed({ user_id: 'U0E2ERATE1', text: '' }))).json();
    if (body.text === copy.slack.tooMany) limited++;
  }
  expect(limited).toBeGreaterThan(0);
  const other = await (await request.post(URL_PATH, signed({ user_id: 'U0E2ERATE2', text: '' }))).json();
  expect(other.text).not.toBe(copy.slack.tooMany);
});
