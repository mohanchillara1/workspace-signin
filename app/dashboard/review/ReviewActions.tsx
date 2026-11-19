'use client';

import { useActionState } from 'react';
import { decideAction, type ReviewState } from './actions';
import { copy } from '@/lib/copy';

/** The Approve button and the comment box with Send back, for one piece of waiting work. */
export function ReviewActions({ assignmentId, title }: { assignmentId: string; title: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(decideAction, {});
  const r = copy.review;
  const id = `comment-${assignmentId}`;
  return (
    <form action={action} className="mt-4 border-t-2 border-ink/20 pt-4">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <label htmlFor={id} className="label">{r.commentLabel}</label>
      <textarea
        id={id}
        name="comment"
        rows={2}
        maxLength={500}
        placeholder={r.commentPlaceholder}
        aria-describedby={`${id}-help`}
        className="field mt-1 w-full"
      />
      <p id={`${id}-help`} className="mt-1 text-sm text-ink/70">{r.commentHelp}</p>
      {state.problem && (
        <p role="alert" data-testid="review-problem" className="mt-3 rounded-xl border-2 border-ink bg-arcade-bumper px-3 py-2 font-bold text-paper">
          {state.problem}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" name="decision" value="approved" disabled={pending} aria-label={`${r.approve}: ${title}`} className="btn-pill bg-arcade-mint text-ink !shadow-[3px_3px_0_0_#151515]">
          {r.approve}
        </button>
        <button type="submit" name="decision" value="sent_back" disabled={pending} aria-label={`${r.sendBack}: ${title}`} className="btn-pill bg-paper text-ink !shadow-[3px_3px_0_0_#151515]">
          {r.sendBack}
        </button>
      </div>
    </form>
  );
}
