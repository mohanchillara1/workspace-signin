'use client';

import { useState } from 'react';
import { copy } from '@/lib/copy';
import { dayLabel } from '@/lib/day';
import type { Handout } from '@/lib/tasks';

// The fill says whose task it is: cream is yours, sky is your subteam's,
// yellow is up for grabs.
const FILL: Record<Handout['group'], string> = {
  yours: 'bg-paper',
  subteam: 'bg-arcade-sky',
  pool: 'bg-arcade-fuel',
};

export function TaskCard({
  handout,
  size = 'phone',
  stepsAlwaysOpen = false,
  busy = false,
  onTake,
  onDone,
  onSteps,
}: {
  handout: Handout;
  size?: 'kiosk' | 'phone';
  stepsAlwaysOpen?: boolean;
  busy?: boolean;
  onTake?: () => void;
  onDone?: () => void;
  /** When given, steps are tick boxes and this is called with the ticked ones. */
  onSteps?: (stepsDone: number[]) => void;
}) {
  const [open, setOpen] = useState(stepsAlwaysOpen);
  const k = copy.kiosk;
  const big = size === 'kiosk';
  const showBody = open || stepsAlwaysOpen;
  const canTake = handout.group === 'pool' && onTake;

  const toggleStep = (index: number) => {
    if (!onSteps) return;
    const next = handout.stepsDone.includes(index)
      ? handout.stepsDone.filter((i) => i !== index)
      : [...handout.stepsDone, index];
    onSteps(next);
  };

  return (
    <article
      data-testid="task"
      className={`rounded-xl border-2 border-ink text-ink ${handout.group === 'yours' ? 'shadow-hard-purple' : 'shadow-hard'} ${FILL[handout.group]} ${big ? 'p-5' : 'p-4'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <button
          type="button"
          aria-expanded={showBody}
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <h3 className={`font-display leading-tight ${big ? 'text-3xl landscape:text-2xl' : 'text-xl'}`}>{handout.title}</h3>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {handout.standing && <span className="chip">{k.standing}</span>}
          {handout.overdue && <span className="chip !border-arcade-bumper !bg-arcade-bumper !text-paper">{k.overdue}</span>}
          {handout.dueDay && !handout.overdue && <span className="chip">{k.dueOn(dayLabel(handout.dueDay))}</span>}
        </div>
      </div>

      {showBody && (
        <div className={`mt-3 ${big ? 'text-xl' : 'text-base'}`}>
          {handout.description && <p className="max-w-prose leading-snug">{handout.description}</p>}
          {handout.steps.length === 0 && !handout.description && <p className="text-ink/75">{k.noSteps}</p>}
          {handout.steps.length > 0 &&
            (onSteps ? (
              <ul className="mt-3 space-y-2">
                {handout.steps.map((step, index) => (
                  <li key={index}>
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5 shrink-0 accent-arcade-purple"
                        checked={handout.stepsDone.includes(index)}
                        onChange={() => toggleStep(index)}
                      />
                      <span className={handout.stepsDone.includes(index) ? 'line-through opacity-60' : ''}>{step}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <ol className="mt-3 list-decimal space-y-1 pl-6">
                {handout.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ))}
          {onSteps && handout.steps.length > 0 && (
            <p className="mt-3 text-sm font-semibold text-ink/70">
              {copy.member.stepsDone(handout.stepsDone.length, handout.steps.length)}
            </p>
          )}
        </div>
      )}

      <div className={`flex flex-wrap items-center gap-3 ${big ? 'mt-5' : 'mt-4'}`}>
        {canTake ? (
          <button type="button" disabled={busy} onClick={onTake} className={`btn-pill bg-ink text-paper !shadow-none ${big ? 'text-xl' : ''}`}>
            {k.take}
          </button>
        ) : (
          onDone && (
            <button type="button" disabled={busy} onClick={onDone} className={`btn-pill bg-arcade-mint text-ink !shadow-none ${big ? 'text-xl' : ''}`}>
              {k.done}
            </button>
          )
        )}
        {!stepsAlwaysOpen && (
          <button type="button" onClick={() => setOpen((value) => !value)} className="text-sm font-bold underline underline-offset-4">
            {showBody ? k.hideSteps : k.showSteps}
          </button>
        )}
      </div>
    </article>
  );
}

const GROUP_TITLE: Record<Handout['group'], string> = {
  yours: copy.kiosk.groupYours,
  subteam: copy.kiosk.groupSubteam,
  pool: copy.kiosk.groupPool,
};

/** Tasks in their three groups: yours, your subteam's, up for grabs. */
export function TaskGroups({
  tasks,
  size,
  render,
}: {
  tasks: Handout[];
  size: 'kiosk' | 'phone';
  render: (handout: Handout) => React.ReactNode;
}) {
  const groups = (['yours', 'subteam', 'pool'] as const)
    .map((group) => ({ group, items: tasks.filter((t) => t.group === group) }))
    .filter((g) => g.items.length > 0);
  if (size === 'phone') {
    return (
      <div className="space-y-6">
        {groups.map(({ group, items }) => (
          <section key={group} data-group={group}>
            <h2 className="mb-2 font-display text-lg">{GROUP_TITLE[group]}</h2>
            <div className="space-y-3">{items.map(render)}</div>
          </section>
        ))}
      </div>
    );
  }
  // On the kiosk the groups stack when the iPad is upright and sit side by
  // side when it is on its side, so the width is used either way. A card that
  // is alone in its group takes the full row.
  const across = groups.length === 3 ? 'landscape:grid-cols-3' : groups.length === 2 ? 'landscape:grid-cols-2' : '';
  const inside = groups.length === 1 ? 'grid-cols-2 landscape:grid-cols-3' : 'grid-cols-2 landscape:grid-cols-1';
  return (
    <div className={`grid gap-8 landscape:items-start landscape:gap-6 ${across}`}>
      {groups.map(({ group, items }) => (
        <section key={group} data-group={group} className="min-w-0">
          <h2 className="mb-3 font-display text-2xl">{GROUP_TITLE[group]}</h2>
          <div className={`grid items-start gap-4 [&>*:only-child]:col-span-full ${inside}`}>{items.map(render)}</div>
        </section>
      ))}
    </div>
  );
}
