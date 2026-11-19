'use client';

import { useEffect, useState } from 'react';
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

// How long "Tap again to finish" waits for the second tap.
const CONFIRM_MS = 4000;

export function TaskCard({
  handout,
  size = 'phone',
  stepsAlwaysOpen = false,
  busy = false,
  onTake,
  onPutBack,
  onDone,
  onSteps,
  doneForm,
}: {
  handout: Handout;
  size?: 'kiosk' | 'phone';
  stepsAlwaysOpen?: boolean;
  busy?: boolean;
  onTake?: () => void;
  onPutBack?: () => void;
  onDone?: () => void;
  /** When given, steps are tick boxes and this is called with the ticked ones. */
  onSteps?: (stepsDone: number[]) => void;
  /**
   * When given, "Done" on a task that needs a lead's check opens this form
   * under the card in place of the two-tap finish. Call close to shut it.
   */
  doneForm?: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(stepsAlwaysOpen);
  // Done takes two taps, so a slip of the thumb does not finish a task. Only
  // a lead can bring a finished task back.
  const [confirming, setConfirming] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const k = copy.kiosk;
  const s = copy.submit;
  const withForm = Boolean(doneForm) && handout.needsCheck;
  const sentBack = handout.state === 'sent_back';
  const big = size === 'kiosk';
  const showBody = open || stepsAlwaysOpen;
  const canTake = handout.group === 'pool' && onTake;
  const chip = big ? 'chip chip-kiosk' : 'chip';

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
        <div className="flex basis-full flex-wrap items-center gap-2 empty:hidden">
          {sentBack && <span className={`${chip} !border-arcade-bumper !bg-arcade-bumper !text-paper`}>{s.sentBackChip}</span>}
          {handout.needsCheck && <span className={chip}>{copy.finished.needsCheck}</span>}
          {handout.standing && <span className={chip}>{k.standing}</span>}
          {handout.overdue && <span className={`${chip} !border-arcade-bumper !bg-arcade-bumper !text-paper`}>{k.overdue}</span>}
          {handout.dueDay && !handout.overdue && <span className={chip}>{k.dueOn(dayLabel(handout.dueDay))}</span>}
        </div>
      </div>

      {sentBack && (
        <div data-testid="sent-back" className={`mt-3 rounded-lg border-2 border-ink bg-arcade-bumper px-3 py-2 text-paper ${big ? 'text-xl' : 'text-base'}`}>
          <p className="font-bold">{s.sentBackTitle}</p>
          {handout.sentBackComment && <p className="mt-1 whitespace-pre-wrap break-words">{handout.sentBackComment}</p>}
          <p className="mt-1 opacity-90">{s.sentBackHint}</p>
        </div>
      )}

      {showBody && (
        <div className={`mt-3 ${big ? 'text-xl' : 'text-base'}`}>
          {handout.description && <p className="max-w-prose leading-snug">{handout.description}</p>}
          {handout.steps.length === 0 && !handout.description && <p className="text-ink/75">{k.noSteps}</p>}
          {handout.steps.length > 0 &&
            (onSteps ? (
              <ul className="mt-3 space-y-1">
                {handout.steps.map((step, index) => (
                  <li key={index}>
                    <label className="flex items-start gap-3 py-1.5">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-6 w-6 shrink-0 accent-arcade-purple"
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

      <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 ${big ? 'mt-5' : 'mt-4'}`}>
        {canTake ? (
          <button type="button" disabled={busy} onClick={onTake} className={`btn-pill bg-ink text-paper !shadow-none ${big ? 'text-xl' : ''}`}>
            {k.take}
          </button>
        ) : (
          onDone && (
            <button
              type="button"
              disabled={busy}
              aria-expanded={withForm ? formOpen : undefined}
              onClick={() => {
                if (withForm) {
                  setFormOpen((value) => !value);
                  return;
                }
                if (confirming) {
                  setConfirming(false);
                  onDone();
                } else setConfirming(true);
              }}
              className={`btn-pill !shadow-none ${confirming && !withForm ? 'bg-ink text-paper' : 'bg-arcade-mint text-ink'} ${big ? 'text-xl' : ''}`}
            >
              {confirming && !withForm ? k.confirmDone : k.done}
            </button>
          )
        )}
        {handout.canGiveBack && onPutBack && (
          <button type="button" disabled={busy} onClick={onPutBack} className={`font-bold underline underline-offset-4 ${big ? 'py-2 text-lg' : 'text-sm'}`}>
            {k.putBack}
          </button>
        )}
        {!stepsAlwaysOpen && (
          <button type="button" onClick={() => setOpen((value) => !value)} className={`font-bold underline underline-offset-4 ${big ? 'py-2 text-lg' : 'text-sm'}`}>
            {showBody ? k.hideSteps : k.showSteps}
          </button>
        )}
      </div>

      {withForm && formOpen && doneForm?.(() => setFormOpen(false))}
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
