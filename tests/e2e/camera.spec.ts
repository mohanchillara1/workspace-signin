import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { chicagoDay } from '@/lib/day';
import { attendance, members } from '@/lib/db/schema';
import { closeDb, db, pairByCookie } from './helpers';

test.afterAll(closeDb);

// Chrome plays a video of one member's QR as its camera. Nothing feeds the
// kiosk a code here: the camera and the decoder do the reading.
test('the camera path reads a QR and signs that member in', async ({ page, context }) => {
  await pairByCookie(context, 'Camera kiosk');
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { name: copy.kiosk.hello('Camera') })).toBeVisible({ timeout: 20000 });
  const [member] = await db().select().from(members).where(eq(members.firstName, 'Camera'));
  const rows = await db()
    .select()
    .from(attendance)
    .where(and(eq(attendance.memberId, member.id), eq(attendance.day, chicagoDay(new Date()))));
  expect(rows).toHaveLength(1);
  expect(rows[0].source).toBe('kiosk');
});
