import Link from 'next/link';
import { markByHand } from '@/app/dashboard/attendance/actions';
import { todayBoard, type BoardRow } from '@/lib/attendance';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, chicagoTime, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { membersWithNothing } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

function Person({ row, children }: { row: BoardRow; children?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block truncate font-bold">{row.fullName}</span>
        {row.subteam && <span className="block truncate text-sm opacity-70">{row.subteam}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-sm">{children}</span>
    </li>
  );
}

export default async function TodayPage() {
  await requireLead();
  const db = getDb();
  const today = chicagoDay(new Date());
  const [board, nothing] = await Promise.all([todayBoard(db, today), membersWithNothing(db, today)]);
  const idle = new Set(nothing.map((n) => n.memberId));
  const hereNothing = board.here.filter((row) => idle.has(row.memberId));
  const t = copy.today;
  const when = (row: BoardRow) =>
    row.source === 'manual' ? t.byHand : row.firstScanAt ? chicagoTime(row.firstScanAt) : '';

  return (
    <>
      <h1 className="text-5xl">{t.title}</h1>
      <p className="mt-1 text-lg text-paper/70">{dayLabel(today)}</p>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-3">
        <section data-list="here" className="on-fill rounded-xl border-2 border-ink bg-arcade-mint p-5 text-ink shadow-hard">
          <h2 className="text-2xl">{t.here(board.here.length)}</h2>
          {board.here.length === 0 ? (
            <p className="mt-2">{t.hereEmpty}</p>
          ) : (
            <ul className="mt-2 divide-y-2 divide-ink/15">
              {board.here.map((row) => (
                <Person key={row.memberId} row={row}>{when(row)}</Person>
              ))}
            </ul>
          )}
        </section>

        <section data-list="here-nothing" className="on-fill rounded-xl border-2 border-ink bg-arcade-fuel p-5 text-ink shadow-hard">
          <h2 className="text-2xl">{t.hereNothing(hereNothing.length)}</h2>
          <p className="mt-1 text-sm">{t.hereNothingHelp}</p>
          {hereNothing.length === 0 ? (
            <p className="mt-2">{t.hereNothingEmpty}</p>
          ) : (
            <ul className="mt-2 divide-y-2 divide-ink/15">
              {hereNothing.map((row) => (
                <Person key={row.memberId} row={row} />
              ))}
            </ul>
          )}
          <Link href="/dashboard/tasks/new" className="btn-small mt-4">{t.giveTask}</Link>
        </section>

        <section data-list="not-here" className="rounded-xl border-2 border-paper/30 bg-deep p-5">
          <h2 className="text-2xl">{t.notHere(board.notHere.length)}</h2>
          {board.notHere.length === 0 ? (
            <p className="mt-2 text-paper/80">{t.notHereEmpty}</p>
          ) : (
            <ul className="mt-2 divide-y-2 divide-paper/10">
              {board.notHere.map((row) => (
                <Person key={row.memberId} row={row}>
                  <form action={markByHand}>
                    <input type="hidden" name="memberId" value={row.memberId} />
                    <input type="hidden" name="day" value={today} />
                    <input type="hidden" name="present" value="1" />
                    <button type="submit" className="btn-small">{t.markHere}</button>
                  </form>
                </Person>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
