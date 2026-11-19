'use client';

import { useActionState } from 'react';
import { logIn, type LoginState } from '@/app/login/actions';
import { copy } from '@/lib/copy';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(logIn, {});
  const c = copy.login;
  return (
    <form action={action} className="card space-y-4 p-6">
      <div>
        <label className="label" htmlFor="loginName">{c.name}</label>
        <input id="loginName" name="loginName" className="field" autoComplete="username" autoCapitalize="none" required />
      </div>
      <div>
        <label className="label" htmlFor="password">{c.password}</label>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required />
      </div>
      {state.error && <p role="alert" className="font-bold text-arcade-bumper">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-pill bg-arcade-purple text-paper !shadow-none">
        {c.submit}
      </button>
      <p className="text-sm text-ink/70">{c.help}</p>
    </form>
  );
}
