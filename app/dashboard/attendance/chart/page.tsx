import Link from 'next/link';
import { markByHand } from '@/app/dashboard/attendance/actions';
import { attendanceChart } from '@/lib/attendance';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { addDays, chicagoDay, dayLabel, isDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// A year back by default: only meeting days become columns, so a wide range costs nothing.
const DEFAULT_SPAN = 365;

export default async function AttendanceChartPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireLead();
  const query = await searchParams;
  const today = chicagoDay(new Date());
  const to = query.to && isDay(query.to) && query.to <= today ? query.to : today;
  const asked = query.from && isDay(query.from) ? query.from : addDays(to, -DEFAULT_SPAN);
  const from = asked <= to ? asked : to;
  const chart = await attendanceChart(getDb(), { from, to });
  const a = copy.attendance;

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-5xl">{a.chartTitle}</h1>
        <Link href="/dashboard/attendance/graph" className="btn-small">{a.graphLink}</Link>
        <Link href="/dashboard/attendance" className="btn-small">{a.chartDayView}</Link>
      </div>
      <p className="mt-3 max-w-3xl text-paper/85">{a.chartIntro}</p>
      <p className="mt-1 max-w-3xl text-sm text-paper/60">{a.chartAddDay}</p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">{a.from}</label>
          <input id="from" name="from" type="date" defaultValue={from} max={today} className="field !w-auto" />
        </div>
        <div>
          <label className="label" htmlFor="to">{a.to}</label>
          <input id="to" name="to" type="date" defaultValue={to} max={today} className="field !w-auto" />
        </div>
        <button type="submit" className="btn-small">{a.show}</button>
      </form>

      <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-paper/80" aria-hidden="true">
        <li className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded border-2 border-ink bg-arcade-mint" />{a.chartLegendHere}</li>
        <li className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded border-2 border-paper/30" />{a.chartLegendAway}</li>
        <li className="flex items-center gap-2"><span className="inline-block h-4 w-4 rounded border-2 border-paper/30 opacity-30" />{a.chartLegendBefore}</li>
      </ul>

      {chart.days.length === 0 ? (
        <p className="mt-6 text-paper/70">{a.chartNoDays}</p>
      ) : (
        // Wide seasons scroll inside this box, so the page itself never scrolls sideways.
        <div className="mt-6 max-w-full overflow-x-auto rounded-xl border-2 border-paper/20 bg-deep">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-deep px-3 py-2 text-left align-bottom">{a.chartName}</th>
                {chart.days.map((day) => {
                  const [weekday, date] = dayLabel(day).split(', ');
                  return (
                    <th key={day} scope="col" className="px-1 py-2 text-center align-bottom font-normal">
                      <Link href={`/dashboard/attendance?day=${day}`} className="block leading-tight underline-offset-2 hover:underline">
                        <span className="block text-xs text-paper/60">{weekday}</span>
                        <span className="block whitespace-nowrap">{date}</span>
                      </Link>
                    </th>
                  );
                })}
                <th scope="col" className="px-3 py-2 text-left align-bottom">{a.chartTotal}</th>
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((row) => {
                const share = row.counted ? Math.round((row.attended / row.counted) * 100) : 0;
                return (
                  <tr key={row.memberId} data-member-name={row.fullName} className="odd:bg-paper/[0.03]">
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-deep px-3 py-1 text-left font-bold">
                      <Link href={`/dashboard/members/${row.memberId}`} className="underline-offset-2 hover:underline">{row.fullName}</Link>
                    </th>
                    {chart.days.map((day) => {
                      const here = row.here.includes(day);
                      const before = day < row.since;
                      return (
                        <td key={day} data-day={day} data-here={here ? '1' : '0'} className="px-1 py-1 text-center">
                          <form action={markByHand}>
                            <input type="hidden" name="memberId" value={row.memberId} />
                            <input type="hidden" name="day" value={day} />
                            <input type="hidden" name="present" value={here ? '0' : '1'} />
                            <button
                              type="submit"
                              aria-pressed={here}
                              aria-label={a.chartCell(row.fullName, dayLabel(day), here)}
                              title={a.chartCell(row.fullName, dayLabel(day), here)}
                              className={`h-8 w-8 rounded-md border-2 font-bold leading-none ${
                                here ? 'border-ink bg-arcade-mint text-ink' : 'border-paper/30 hover:border-paper/70'
                              } ${before && !here ? 'opacity-30' : ''}`}
                            >
                              {here ? '✓' : ''}
                            </button>
                          </form>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-1">
                      <span data-testid="total">{a.chartTotalOf(row.attended, row.counted)}</span>
                      <span className="ml-2 inline-block h-2 w-16 overflow-hidden rounded bg-paper/15 align-middle" aria-hidden="true">
                        <span className="block h-full bg-arcade-mint" style={{ width: `${share}%` }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-deep px-3 py-2 text-left">{a.chartDayTotal}</th>
                {chart.days.map((day, i) => (
                  <td key={day} data-testid={`day-total-${day}`} className="px-1 py-2 text-center font-bold">
                    {chart.dayTotals[i]}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
