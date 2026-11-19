'use client';

import { useActionState, useRef, useState } from 'react';
import { draftStepsAction } from '@/app/dashboard/tasks/draft-action';
import { saveTask, type TaskFormState } from '@/app/dashboard/tasks/actions';
import { copy } from '@/lib/copy';

export type TaskFormValues = {
  id?: string;
  state?: 'draft' | 'published' | 'closed';
  title: string;
  description: string;
  steps: string;
  audience: 'person' | 'subteam' | 'pool';
  memberIds: string[];
  subteamId: string;
  completion: 'once' | 'each';
  dueDay: string;
  standing: boolean;
  needsCheck: boolean;
};

export function TaskForm({
  initial,
  people,
  subteams,
  canDraft = false,
}: {
  initial: TaskFormValues;
  people: { id: string; name: string }[];
  subteams: { id: string; name: string }[];
  // True only when the page found drafting turned on. Without it there is no button.
  canDraft?: boolean;
}) {
  const [state, action, pending] = useActionState<TaskFormState, FormData>(saveTask, {});
  // Controlled fields: what a lead typed is still there if the save is refused.
  const [v, setV] = useState(initial);
  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => setV((old) => ({ ...old, [key]: value }));
  const t = copy.tasks;
  const d = copy.drafts;
  const [drafting, setDrafting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [draftNote, setDraftNote] = useState<{ kind: 'ok' | 'problem'; text: string } | null>(null);
  const stepsNow = useRef(v.steps);
  stepsNow.current = v.steps;
  const audience = v.standing ? 'pool' : v.audience;
  const group = audience === 'subteam' || (audience === 'person' && v.memberIds.length > 1);
  const closed = v.state === 'closed';

  async function draft() {
    if (drafting) return;
    setAsking(false);
    setDraftNote(null);
    if (!v.title.trim()) {
      setDraftNote({ kind: 'problem', text: d.needTitle });
      return;
    }
    const before = stepsNow.current;
    setDrafting(true);
    try {
      const result = await draftStepsAction({ title: v.title, description: v.description, subteamId: audience === 'subteam' ? v.subteamId : '' });
      if (result.problem !== undefined) {
        setDraftNote({ kind: 'problem', text: result.problem });
      } else if (stepsNow.current !== before) {
        // The lead typed while it was working. Their words win.
        setDraftNote({ kind: 'problem', text: d.changedWhileWaiting });
      } else {
        set('steps', result.steps.join('\n'));
        setDraftNote({ kind: 'ok', text: d.filled });
      }
    } catch {
      setDraftNote({ kind: 'problem', text: d.failed });
    } finally {
      setDrafting(false);
    }
  }

  return (
    <form action={action} className="card max-w-3xl space-y-5 p-6">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div>
        <label className="label" htmlFor="title">{t.fieldTitle}</label>
        <input id="title" name="title" className="field" maxLength={120} required value={v.title} onChange={(e) => set('title', e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="description">{t.fieldDescription}</label>
        <textarea id="description" name="description" rows={2} className="field" value={v.description} onChange={(e) => set('description', e.target.value)} />
        <p className="mt-1 text-sm text-ink/70">{t.fieldDescriptionHelp}</p>
      </div>
      <div>
        <label className="label" htmlFor="steps">{t.fieldSteps}</label>
        <textarea id="steps" name="steps" rows={5} className="field" value={v.steps} onChange={(e) => set('steps', e.target.value)} />
        <p className="mt-1 text-sm text-ink/70">{t.fieldStepsHelp}</p>
        {canDraft && !closed && (
          <div className="mt-3 space-y-2" data-testid="draft-steps">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-small"
                disabled={drafting}
                aria-busy={drafting}
                onClick={() => (v.steps.trim() ? (setDraftNote(null), setAsking(true)) : void draft())}
              >
                {drafting ? d.working : d.button}
              </button>
              <span className="text-sm text-ink/70">{d.notice}</span>
            </div>
            {asking && !drafting && (
              <div role="alert" className="rounded-lg border-2 border-ink bg-paper p-3">
                <p className="font-bold">{d.replaceAsk}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <button type="button" className="btn-small" onClick={() => void draft()}>{d.replaceYes}</button>
                  <button type="button" className="btn-small" onClick={() => setAsking(false)}>{d.replaceNo}</button>
                </div>
              </div>
            )}
            {draftNote && (
              <p role={draftNote.kind === 'problem' ? 'alert' : 'status'} className={draftNote.kind === 'problem' ? 'font-bold text-arcade-bumper' : 'font-bold text-ink'}>
                {draftNote.text}
              </p>
            )}
          </div>
        )}
      </div>

      <label className="flex items-start gap-3">
        <input type="checkbox" name="standing" className="mt-1 h-5 w-5 accent-arcade-purple" checked={v.standing} onChange={(e) => setV((old) => ({ ...old, standing: e.target.checked, needsCheck: e.target.checked ? false : old.needsCheck }))} />
        <span>
          <span className="font-bold">{t.fieldStanding}</span>
          <span className="block text-sm text-ink/70">{t.fieldStandingHelp}</span>
        </span>
      </label>

      <fieldset disabled={v.standing} className="space-y-2 disabled:opacity-50">
        <legend className="label">{t.fieldAudience}</legend>
        {(['person', 'subteam', 'pool'] as const).map((value) => (
          <label key={value} className="flex items-center gap-3">
            <input type="radio" name="audience" value={value} className="h-5 w-5 accent-arcade-purple" checked={audience === value} onChange={() => set('audience', value)} />
            {value === 'person' ? t.audiencePerson : value === 'subteam' ? t.audienceSubteam : t.audiencePool}
          </label>
        ))}
      </fieldset>
      {v.standing && <input type="hidden" name="audience" value="pool" />}

      {audience === 'person' && (
        <fieldset>
          <legend className="label">{t.fieldPeople}</legend>
          <div className="grid gap-x-6 gap-y-2 rounded-lg border-2 border-ink/20 p-3 sm:grid-cols-2">
            {people.map((person) => (
              <label key={person.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="memberIds"
                  value={person.id}
                  className="h-5 w-5 accent-arcade-purple"
                  checked={v.memberIds.includes(person.id)}
                  onChange={(e) => set('memberIds', e.target.checked ? [...v.memberIds, person.id] : v.memberIds.filter((id) => id !== person.id))}
                />
                {person.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {audience === 'subteam' && (
        <div>
          <label className="label" htmlFor="subteamId">{t.fieldSubteam}</label>
          <select id="subteamId" name="subteamId" className="field" value={v.subteamId} onChange={(e) => set('subteamId', e.target.value)}>
            <option value="" />
            {subteams.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {group && (
        <fieldset className="space-y-2">
          <legend className="label">{t.fieldCompletion}</legend>
          {(['once', 'each'] as const).map((value) => (
            <label key={value} className="flex items-center gap-3">
              <input type="radio" name="completion" value={value} className="h-5 w-5 accent-arcade-purple" checked={v.completion === value} onChange={() => set('completion', value)} />
              {value === 'once' ? t.completionOnce : t.completionEach}
            </label>
          ))}
        </fieldset>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="dueDay">{t.fieldDue}</label>
          <input id="dueDay" name="dueDay" type="date" className="field" value={v.dueDay} onChange={(e) => set('dueDay', e.target.value)} />
          <p className="mt-1 text-sm text-ink/70">{t.fieldDueHelp}</p>
        </div>
        <label className="flex items-start gap-3 sm:pt-7">
          <input type="checkbox" name="needsCheck" className="mt-1 h-5 w-5 accent-arcade-purple" checked={v.needsCheck} onChange={(e) => set('needsCheck', e.target.checked)} />
          <span className="font-bold">{t.fieldNeedsCheck}</span>
        </label>
      </div>

      {state.problem && <p role="alert" className="font-bold text-arcade-bumper">{t.problem(state.problem)}</p>}

      <div className="flex flex-wrap gap-3">
        {!closed && (
          <button type="submit" name="intent" value="save" disabled={pending} className="btn-pill bg-paper text-ink !shadow-none">
            {v.state === 'published' ? t.save : t.saveDraft}
          </button>
        )}
        {v.state !== 'published' && (
          <button type="submit" name="intent" value="publish" disabled={pending} className="btn-pill bg-arcade-purple text-paper !shadow-none">
            {t.publish}
          </button>
        )}
        {v.id && v.state === 'published' && (
          <button type="submit" name="intent" value="close" disabled={pending} className="btn-pill bg-ink text-paper !shadow-none">
            {t.close}
          </button>
        )}
      </div>
    </form>
  );
}
