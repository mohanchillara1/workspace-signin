'use client';

import { useActionState, useState } from 'react';
import { makeInvite, type InviteLinkState } from '@/app/dashboard/members/actions';
import { copy } from '@/lib/copy';

export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const c = copy.members;
  return (
    <button
      type="button"
      className="btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt(c.copyLink, `${window.location.origin}${path}`);
        }
      }}
    >
      {copied ? c.copied : c.copyLink}
    </button>
  );
}

export function InviteButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState<InviteLinkState, FormData>(makeInvite, {});
  const c = copy.members;
  return (
    <form action={action} className="contents">
      <input type="hidden" name="id" value={memberId} />
      <button type="submit" disabled={pending} className="btn-small">{c.invite}</button>
      {state.link && (
        <span className="mt-2 block w-full">
          <input data-testid="invite-link" readOnly value={state.link} className="field text-sm" onFocus={(e) => e.currentTarget.select()} />
          <span className="mt-1 block text-sm text-paper/70">{c.inviteReady}</span>
        </span>
      )}
      {state.problem && <span role="alert" className="block w-full text-sm font-bold text-arcade-fuel">{c.problem(state.problem)}</span>}
    </form>
  );
}
