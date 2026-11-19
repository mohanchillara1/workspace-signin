'use client';

import { useActionState, useState } from 'react';
import { setLogin, type InviteState } from '@/app/invite/[token]/actions';
import { copy } from '@/lib/copy';

export function InviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(setLogin, {});
  // Controlled, so a refused password does not wipe the login name.
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const c = copy.invite;
  return (
    <form action={action} className="card space-y-4 p-6">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="loginName">{c.name}</label>
        <input id="loginName" name="loginName" className="field" autoComplete="username" autoCapitalize="none" required value={loginName} onChange={(e) => setLoginName(e.target.value)} />
        <p className="mt-1 text-sm text-ink/70">{c.nameHelp}</p>
      </div>
      <div>
        <label className="label" htmlFor="password">{c.password}</label>
        <input id="password" name="password" type="password" className="field" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="mt-1 text-sm text-ink/70">{c.passwordHelp}</p>
      </div>
      {state.error && <p role="alert" className="font-bold text-arcade-bumper">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-pill bg-arcade-purple text-paper !shadow-none">
        {c.submit}
      </button>
    </form>
  );
}
