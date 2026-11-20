'use client';

import { useActionState } from 'react';
import { openMemberPage, type LoginState } from '@/app/login/actions';
import { copy } from '@/lib/copy';

export function MemberLoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(openMemberPage, {});
  const c = copy.login;
  return (
    <form action={action} className="card space-y-4 p-6" data-testid="member-login">
      <h2 className="text-2xl">{c.memberTitle}</h2>
      <p className="text-sm text-ink/70">{c.memberHelp}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="firstName">{c.firstName}</label>
          <input id="firstName" name="firstName" className="field" autoComplete="given-name" maxLength={60} required />
        </div>
        <div>
          <label className="label" htmlFor="lastName">{c.lastName}</label>
          <input id="lastName" name="lastName" className="field" autoComplete="family-name" maxLength={60} required />
        </div>
      </div>
      {state.error && <p role="alert" className="font-bold text-arcade-bumper">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-pill bg-arcade-fuel text-ink !shadow-none">
        {c.memberSubmit}
      </button>
    </form>
  );
}
