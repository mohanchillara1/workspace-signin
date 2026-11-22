'use client';

// The attendance graph's bars: one for each meeting day, as tall as the number
// who came, over a faint bar for how many were on the team then. Tapping a bar
// picks that day and lists who came and who missed under it.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { GraphName } from '@/lib/attendance';
import { copy } from '@/lib/copy';

export type BarDay = {
  day: string;
  /** Written out, like "Wed, Nov 18". */
  label: string;
  dayOfMonth: string;
  /** The month's short name on the first meeting of each month, else null. */
  month: string | null;
  here: number;
  of: number;
  /** Who came and who missed, as places in the `names` list: each name is sent once, not once a day. */
  came: number[];
  missed: number[];
};

/** Each bar's slot is at least this wide, so a long season scrolls instead of squeezing. */
const SLOT = 30;
/** The plot's height, and the room kept above the tallest bar for its labels. */
const PLOT = 220;
const HEADROOM = 40;

/** Clean ticks from 0, at most six of them. */
function scale(max: number): { top: number; ticks: number[] } {
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => Math.ceil(max / s) <= 5) ?? 100;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { top, ticks };
}

function NameList({ names, testId, here }: { names: GraphName[]; testId: string; here: boolean }) {
  const a = copy.attendance;
  const title = here ? a.graphCame(names.length) : a.graphMissed(names.length);
  return (
    <div data-testid={testId}>
      <h4 className="font-bold">{title}</h4>
      {names.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">{a.graphNobody}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {names.map((n) => (
            <li key={n.memberId}>
              <Link
                href={`/dashboard/members/${n.memberId}`}
                className={`inline-block rounded-full border-2 px-3 py-1 text-sm font-bold underline-offset-2 hover:underline ${
                  here ? 'border-ink bg-arcade-mint' : 'border-ink/25'
                }`}
              >
                {n.fullName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AttendanceBars({ days, names, today }: { days: BarDay[]; names: GraphName[]; today: string }) {
  const a = copy.attendance;
  const [picked, setPicked] = useState<string | null>(null);
  const [pointing, setPointing] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Open on the newest meetings. Only once: a refresh keeps where the lead scrolled to.
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollLeft = box.scrollWidth;
  }, []);

  if (days.length === 0) return null;
  const chosen = days.find((d) => d.day === picked) ?? days[days.length - 1];
  const { top, ticks } = scale(Math.max(...days.map((d) => Math.max(d.of, d.here))));
  const pct = (n: number) => `${(n / top) * 100}%`;
  const tip = pointing === null ? null : days[pointing];
  // Near either end the tip leans inwards, so it never runs off the box.
  const lean = pointing === null ? '-50%' : pointing < 2 ? '0%' : pointing > days.length - 3 ? '-100%' : '-50%';

  return (
    <>
      <section aria-labelledby="graph-bars" className="mt-8 rounded-xl border-2 border-paper/20 bg-deep p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="graph-bars" className="text-2xl">{a.graphBarsTitle}</h2>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-paper/75" aria-hidden="true">
            <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm bg-arcade-mint" />{a.graphLegendHere}</li>
            <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm bg-paper/15" />{a.graphLegendTeam}</li>
          </ul>
        </div>

        <div className="mt-4 flex">
          {/* The count scale stays put while the bars scroll. */}
          <div className="relative w-8 shrink-0" style={{ height: PLOT }} aria-hidden="true">
            <div className="absolute inset-x-0 bottom-0" style={{ top: HEADROOM }}>
              {ticks.map((t) => (
                <span key={t} className="absolute right-2 translate-y-1/2 text-xs tabular-nums text-paper/50" style={{ bottom: pct(t) }}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pb-1">
            <div className="relative" style={{ minWidth: days.length * SLOT }}>
              <div className="relative" style={{ height: PLOT }}>
                <div className="absolute inset-x-0 bottom-0" style={{ top: HEADROOM }} aria-hidden="true">
                  {ticks.map((t) => (
                    <div key={t} className="absolute inset-x-0 border-t border-paper/10" style={{ bottom: pct(t) }} />
                  ))}
                </div>

                <div className="absolute inset-0 flex">
                  {days.map((d, i) => {
                    const isPicked = d.day === chosen.day;
                    const isToday = d.day === today;
                    return (
                      <button
                        key={d.day}
                        type="button"
                        data-graph-day={d.day}
                        data-here={d.here}
                        data-of={d.of}
                        aria-pressed={isPicked}
                        aria-label={a.graphBar(d.label, d.here, d.of)}
                        onClick={() => setPicked(d.day)}
                        onPointerEnter={() => setPointing(i)}
                        onPointerLeave={() => setPointing(null)}
                        onFocus={() => setPointing(i)}
                        onBlur={() => setPointing(null)}
                        className="group relative h-full flex-1 rounded-md outline-none focus-visible:bg-paper/5"
                        style={{ minWidth: SLOT }}
                      >
                        <span className="absolute inset-x-0 bottom-0" style={{ top: HEADROOM }}>
                          <span
                            className="absolute bottom-0 left-1/2 w-[calc(100%-6px)] max-w-[24px] -translate-x-1/2 rounded-t-[4px] bg-paper/[0.08]"
                            style={{ height: pct(d.of) }}
                          />
                          <span
                            className={`absolute bottom-0 left-1/2 w-[calc(100%-6px)] max-w-[24px] -translate-x-1/2 rounded-t-[4px] transition-colors ${
                              isPicked ? 'bg-arcade-fuel' : 'bg-arcade-mint group-hover:bg-paper group-focus-visible:bg-paper'
                            }`}
                            style={{ height: pct(d.here) }}
                          />
                          {(isPicked || isToday) && pointing !== i && (
                            <span
                              className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-xs font-bold leading-tight"
                              style={{ bottom: `calc(${pct(d.here)} + 4px)` }}
                              aria-hidden="true"
                            >
                              {isToday && <span className="block text-[10px] uppercase tracking-wide text-arcade-fuel">{a.graphToday}</span>}
                              {d.here}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {tip && (
                  <div
                    className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-lg border-2 border-ink bg-paper px-3 py-1 text-sm text-ink"
                    style={{ left: `${((pointing! + 0.5) / days.length) * 100}%`, transform: `translateX(${lean})` }}
                    aria-hidden="true"
                  >
                    <span className="font-bold">{a.graphDayCount(tip.here, tip.of)}</span>
                    <span className="ml-2 text-ink/70">{tip.label}</span>
                  </div>
                )}
              </div>

              <div className="flex pt-1" aria-hidden="true">
                {days.map((d) => (
                  <span
                    key={d.day}
                    className={`flex-1 text-center text-[11px] tabular-nums ${d.day === chosen.day ? 'font-bold text-paper' : 'text-paper/55'}`}
                    style={{ minWidth: SLOT }}
                  >
                    {d.dayOfMonth}
                  </span>
                ))}
              </div>
              <div className="flex h-4" aria-hidden="true">
                {days.map((d) => (
                  <span key={d.day} className="flex-1 overflow-visible whitespace-nowrap pl-1 text-[11px] font-bold uppercase tracking-wide text-paper/70" style={{ minWidth: SLOT }}>
                    {d.month}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section data-testid="graph-day" className="on-fill mt-6 rounded-xl border-2 border-ink bg-paper p-5 text-ink shadow-hard-purple">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {chosen.day === today && <p className="text-xs font-bold uppercase tracking-wide text-arcade-purple">{a.graphToday}</p>}
            <h3 className="text-3xl">{chosen.label}</h3>
            <p className="mt-1 text-lg">{a.graphDayCount(chosen.here, chosen.of)}</p>
          </div>
          <Link href={`/dashboard/attendance?day=${chosen.day}`} className="btn-small">{a.graphOpenDay}</Link>
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <NameList names={chosen.came.map((i) => names[i])} testId="came" here />
          <NameList names={chosen.missed.map((i) => names[i])} testId="missed" here={false} />
        </div>
      </section>
    </>
  );
}
