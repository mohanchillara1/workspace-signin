import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MemberTasks } from '@/components/member/MemberTasks';
import { memberCount } from '@/lib/attendance';
import { clientAddress } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { memberByPageKey } from '@/lib/members';
import { qrSvg } from '@/lib/qr';
import { hit } from '@/lib/rate-limit';
import { openFor } from '@/lib/tasks';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.app.title };

const LOADS_A_MINUTE = 30;

export default async function MemberPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const db = getDb();
  const now = new Date();
  const address = await clientAddress();
  const allowed = await hit(db, { key: `member-page:${address}`, limit: LOADS_A_MINUTE, windowSeconds: 60, now });
  if (!allowed.allowed) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-3xl">{copy.app.tooManyTitle}</h1>
        <p className="mt-3 text-lg text-paper/85">{copy.app.tooManyBody}</p>
      </main>
    );
  }
  // A wrong key and a deactivated member's key get the same page.
  const member = await memberByPageKey(db, key);
  if (!member) notFound();

  const today = chicagoDay(now);
  const [svg, tasks, count] = await Promise.all([
    qrSvg(member.scanCode),
    openFor(db, member.id, today),
    memberCount(db, member.id, today),
  ]);
  const m = copy.member;

  return (
    <main className="mx-auto max-w-md px-4 pb-12 pt-8">
      <h1 className="text-4xl">{m.greeting(member.firstName)}</h1>

      <div className="mt-6 flex flex-col items-center">
        <div
          data-testid="qr"
          role="img"
          aria-label={m.qrAlt}
          className="sticker-frame w-full max-w-[20rem] -rotate-1 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded-md"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="mt-5 text-center text-lg font-semibold">{m.qrCaption}</p>
        <p className="mt-1 text-center text-sm text-paper/70">{m.saveTip}</p>
      </div>

      <p data-testid="count" className="mt-8 rounded-xl border-2 border-paper/25 px-4 py-3 text-base">
        {count.meetingDays === 0
          ? m.countNone(dayLabel(count.since))
          : m.count(count.attended, count.meetingDays, dayLabel(count.since))}
      </p>

      <h2 className="mb-3 mt-8 text-2xl">{m.tasksTitle}</h2>
      <MemberTasks pageKey={key} tasks={tasks} />
    </main>
  );
}
