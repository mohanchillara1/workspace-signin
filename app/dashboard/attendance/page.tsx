import Link from 'next/link';
import { markByHand, setStruck } from '@/app/dashboard/attendance/actions';
import { attendanceRows, changesFor, meetingDays, struckDaysIn, todayBoard, type ExportRow } from '@/lib/attendance';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { addDays, chicagoDay, chicagoTime, dayLabel, isDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { listMembers } from '@/lib/members';

export const dynamic = 'force-dynamic';

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  await requireLead();
  const query = await searchParams;
  const today = chicagoDay(new Date());
  const day = query.day && isDay(query.day) ? query.day : today;
  const db = getDb();
  const range = { from: day, to: day };
  const [rows, board, meetings, struck, members, changes] = await Promise.all([
    attendanceRows(db, range),
    todayBoard(db, day),
    meetingDays(db, range),
    struckDaysIn(db, range),
    listMembers(db),
    changesFor(db, day),
  ]);
  const fullName = new Map(members.map((m) => [m.id, `${m.firstName} ${m.lastName}`.trim()]));
  const a = copy.attendance;
  const isStruck = struck.length > 0;
  const how = (row: ExportRow) =>
    row.source === 'kiosk' && row.firstScanAt
      ? a.scanned(chicagoTime(row.firstScanAt))
      : row.source === 'sheet'
        ? a.fromSheet(dayLabel(chicagoDay(row.addedAt)))
        : a.byHand(row.recordedBy);

  return (
    <>
      <h1 className="text-5xl">{a.title}</h1>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Link href={`/dashboard/attendance?day=${addDays(day, -1)}`} className="btn-small">{a.previous}</Link>
        <form method="get" className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="day">{a.dayLabel}</label>
            <input id="day" name="day" type="date" defaultValue={day} max={today} className="field !w-auto" />
          </div>
          <button type="submit" className="btn-small">{a.show}</button>
        </form>
        {day < today && <Link href={`/dashboard/attendance?day=${addDays(day, 1)}`} className="btn-small">{a.next}</Link>}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h2 className="text-3xl">{dayLabel(day)}</h2>
        <p className="text-paper/75">{isStruck ? a.struckNote : meetings.length ? a.meetingNote : a.notMeetingNote}</p>
        <form action={setStruck}>
          <input type="hidden" name="day" value={day} />
          <input type="hidden" name="struck" value={isStruck ? '0' : '1'} />
          <button type="submit" className="btn-small">{isStruck ? a.unstrike : a.strike}</button>
        </form>
        {!isStruck && <p className="w-full text-sm text-paper/60">{a.strikeHelp}</p>}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="on-fill rounded-xl border-2 border-ink bg-arcade-mint p-5 text-ink shadow-hard">
          <h3 className="text-2xl">{a.present(rows.length)}</h3>
          {rows.length === 0 ? (
            <p className="mt-2">{a.none}</p>
          ) : (
            <ul className="mt-2 divide-y-2 divide-ink/15">
              {rows.map((row) => (
                <li key={row.memberId} data-member-name={fullName.get(row.memberId)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <span>
                    <span className="font-bold">{fullName.get(row.memberId)}</span>
                    <span className="ml-2 text-sm">{how(row)}</span>
                  </span>
                  <form action={markByHand}>
                    <input type="hidden" name="memberId" value={row.memberId} />
                    <input type="hidden" name="day" value={day} />
                    <input type="hidden" name="present" value="0" />
                    <button type="submit" className="btn-small">{a.remove}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border-2 border-paper/30 bg-deep p-5">
          <h3 className="text-2xl">{a.absent(board.notHere.length)}</h3>
          <ul className="mt-2 divide-y-2 divide-paper/10">
            {board.notHere.map((row) => (
              <li key={row.memberId} data-member-name={fullName.get(row.memberId)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <span className="font-bold">{fullName.get(row.memberId)}</span>
                <form action={markByHand}>
                  <input type="hidden" name="memberId" value={row.memberId} />
                  <input type="hidden" name="day" value={day} />
                  <input type="hidden" name="present" value="1" />
                  <button type="submit" className="btn-small">{a.markHere}</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section data-testid="changes" className="mt-8 max-w-3xl">
        <h3 className="text-2xl">{a.changesTitle}</h3>
        {changes.length === 0 ? (
          <p className="mt-2 text-paper/70">{a.changesNone}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-paper/85">
            {changes.map((change, index) => {
              const time = chicagoTime(change.at);
              const who = change.who || a.byScript;
              return (
                <li key={index}>
                  {change.what === 'added'
                    ? a.changeAdded(who, change.member, time)
                    : change.what === 'removed'
                      ? a.changeRemoved(who, change.member, time)
                      : change.what === 'struck'
                        ? a.changeStruck(who, time)
                        : a.changeUnstruck(who, time)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form method="get" action="/dashboard/attendance/export" className="card mt-10 flex max-w-2xl flex-wrap items-end gap-3 p-5">
        <h3 className="w-full text-2xl">{a.exportTitle}</h3>
        <div>
          <label className="label" htmlFor="from">{a.from}</label>
          <input id="from" name="from" type="date" defaultValue={addDays(today, -30)} className="field !w-auto" required />
        </div>
        <div>
          <label className="label" htmlFor="to">{a.to}</label>
          <input id="to" name="to" type="date" defaultValue={today} className="field !w-auto" required />
        </div>
        <button type="submit" className="btn-pill bg-arcade-purple text-paper !shadow-none">{a.download}</button>
      </form>
    </>
  );
}
