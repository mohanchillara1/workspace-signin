import Link from 'next/link';
import { AttendanceBars, type BarDay } from '@/components/dashboard/AttendanceBars';
import { LiveRefresh } from '@/components/dashboard/LiveRefresh';
import { attendanceGraph } from '@/lib/attendance';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { addDays, chicagoDay, chicagoTime, dayLabel, isDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { listSubteams } from '@/lib/members';

export const dynamic = 'force-dynamic';

// A year back by default, as on the season chart.
const DEFAULT_SPAN = 365;
const monthName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-xl border-2 border-paper/20 bg-deep px-3 py-3 sm:px-4">
      <p className="text-xs leading-tight text-paper/70 sm:text-sm">{label}</p>
      <p className="mt-1 font-sans text-3xl font-extrabold sm:text-4xl">{value}</p>
      <p className="mt-1 text-xs leading-tight text-paper/60 sm:text-sm">{sub}</p>
    </div>
  );
}

export default async function AttendanceGraphPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; subteam?: string }>;
}) {
  await requireLead();
  const query = await searchParams;
  const db = getDb();
  const today = chicagoDay(new Date());
  const to = query.to && isDay(query.to) && query.to <= today ? query.to : today;
  const asked = query.from && isDay(query.from) ? query.from : addDays(to, -DEFAULT_SPAN);
  const from = asked <= to ? asked : to;
  const subteams = await listSubteams(db);
  const subteam = subteams.find((s) => s.id === query.subteam) ?? null;
  const graph = await attendanceGraph(db, { from, to, subteamId: subteam?.id ?? null });
  const refreshSeconds = Number(process.env.GRAPH_REFRESH_SECONDS) || 20;
  const a = copy.attendance;

  const names = graph.people.map((p) => ({ memberId: p.memberId, fullName: p.fullName }));
  const place = new Map(names.map((n, i) => [n.memberId, i]));
  const days: BarDay[] = graph.days.map((d, i) => ({
    day: d.day,
    here: d.here,
    of: d.of,
    came: d.hereNames.map((n) => place.get(n.memberId)!),
    missed: d.missedNames.map((n) => place.get(n.memberId)!),
    label: dayLabel(d.day),
    dayOfMonth: String(Number(d.day.slice(8))),
    month: i === 0 || graph.days[i - 1].day.slice(0, 7) !== d.day.slice(0, 7) ? monthName.format(new Date(`${d.day}T12:00:00Z`)) : null,
  }));
  const newest = graph.days[graph.days.length - 1];
  const average = graph.days.length ? graph.days.reduce((sum, d) => sum + d.here, 0) / graph.days.length : 0;
  const best = graph.days.reduce<(typeof graph.days)[number] | null>((top, d) => (!top || d.here > top.here ? d : top), null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-5xl">{a.graphTitle}</h1>
        <Link href="/dashboard/attendance/chart" className="btn-small">{a.chartLink}</Link>
        <Link href="/dashboard/attendance" className="btn-small">{a.chartDayView}</Link>
      </div>
      <p className="mt-3 max-w-3xl text-paper/85">{a.graphIntro}</p>
      <LiveRefresh seconds={refreshSeconds} updated={chicagoTime(new Date())} />

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">{a.from}</label>
          <input id="from" name="from" type="date" defaultValue={from} max={today} className="field !w-auto" />
        </div>
        <div>
          <label className="label" htmlFor="to">{a.to}</label>
          <input id="to" name="to" type="date" defaultValue={to} max={today} className="field !w-auto" />
        </div>
        <div>
          <label className="label" htmlFor="subteam">{a.graphSubteam}</label>
          <select id="subteam" name="subteam" defaultValue={subteam?.id ?? ''} className="field !w-auto">
            <option value="">{a.graphEveryone}</option>
            {subteams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.parentName ? `  ${s.name}` : s.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-small">{a.show}</button>
      </form>

      {graph.days.length === 0 ? (
        <p className="mt-8 text-paper/70">{a.chartNoDays}</p>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-4">
            {newest.day === today ? (
              <Stat label={a.graphStatToday} value={String(newest.here)} sub={a.graphStatOf(newest.of)} />
            ) : (
              <Stat label={a.graphStatLast} value={String(newest.here)} sub={dayLabel(newest.day)} />
            )}
            <Stat
              label={a.graphStatAverage}
              value={Number.isInteger(average) ? String(average) : average.toFixed(1)}
              sub={a.graphStatMeetings(graph.days.length)}
            />
            {best && <Stat label={a.graphStatBest} value={String(best.here)} sub={dayLabel(best.day)} />}
          </div>

          <AttendanceBars days={days} names={names} today={today} />

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-paper/70 underline-offset-2 hover:underline">{a.graphNumbers}</summary>
            <div className="mt-3 max-w-full overflow-x-auto rounded-xl border-2 border-paper/20 bg-deep">
              <table data-testid="graph-numbers" className="w-full text-left">
                <thead>
                  <tr className="text-paper/70">
                    <th scope="col" className="px-3 py-2 font-normal">{a.graphNumbersDay}</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">{a.graphNumbersCame}</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">{a.graphNumbersTeam}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...days].reverse().map((d) => (
                    <tr key={d.day} className="odd:bg-paper/[0.03]">
                      <th scope="row" className="px-3 py-1 font-normal">{d.label}</th>
                      <td className="px-3 py-1 text-right font-bold">{d.here}</td>
                      <td className="px-3 py-1 text-right">{d.of}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <section className="mt-10">
        <h2 className="text-2xl">{a.graphPeopleTitle}</h2>
        <p className="mt-1 max-w-3xl text-sm text-paper/70">{a.graphPeopleHelp}</p>
        {graph.people.length === 0 ? (
          <p className="mt-4 text-paper/70">{a.graphPeopleNone}</p>
        ) : (
          <ol className="mt-4 divide-y-2 divide-paper/10 rounded-xl border-2 border-paper/20 bg-deep">
            {graph.people.map((p) => (
              <li
                key={p.memberId}
                data-person-name={p.fullName}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_7.5rem_auto]"
              >
                <Link href={`/dashboard/members/${p.memberId}`} className="order-1 truncate font-bold underline-offset-2 hover:underline">
                  {p.fullName}
                </Link>
                {p.share === null ? (
                  <span className="order-2 text-sm text-paper/60 sm:order-3">{a.graphNew}</span>
                ) : (
                  <span className="order-2 whitespace-nowrap text-right sm:order-3">
                    <span className="text-lg font-bold">{p.share}%</span>
                    <span className="ml-2 text-sm tabular-nums text-paper/60">{a.graphShareOf(p.attended, p.counted)}</span>
                  </span>
                )}
                <span className="order-3 block h-2.5 overflow-hidden rounded-full bg-paper/10 sm:order-2" aria-hidden="true">
                  <span className="block h-full rounded-full bg-arcade-mint" style={{ width: `${p.share ?? 0}%` }} />
                </span>
                <span className="order-4 flex gap-1" role="img" aria-label={a.graphLast(p.last)}>
                  {p.last.map((mark, i) => (
                    <span
                      key={i}
                      className={`inline-block h-3 w-3 rounded-[3px] ${
                        mark === 'here' ? 'bg-arcade-mint' : mark === 'missed' ? 'border-2 border-paper/40' : 'border-2 border-paper/10'
                      }`}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
