import Link from 'next/link';
import {
  addMemberAction,
  addSubteamAction,
  editMemberAction,
  memberRowAction,
  removeSubteamAction,
  rosterAction,
} from '@/app/dashboard/members/actions';
import { CopyLink, InviteButton } from '@/components/dashboard/MemberBits';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { errorText } from '@/lib/errors';
import { listMembers, listSubteams } from '@/lib/members';

export const dynamic = 'force-dynamic';

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string; skipped?: string; already?: string; problem?: string }>;
}) {
  const lead = await requireLead();
  const query = await searchParams;
  const db = getDb();
  const [members, subteams] = await Promise.all([listMembers(db), listSubteams(db)]);
  const c = copy.members;
  const captain = lead.role === 'captain';
  const roleLabel = { member: c.roleMember, lead: c.roleLead, captain: c.roleCaptain };
  const count = (value: string | undefined) => Math.max(0, Math.min(9999, Number(value) || 0));
  const subteamOptions = (
    <>
      <option value="">{c.noSubteam}</option>
      {subteams.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </>
  );
  const roleOptions = (['member', 'lead', 'captain'] as const).map((role) => (
    <option key={role} value={role}>{roleLabel[role]}</option>
  ));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl">{c.title}</h1>
        <Link href="/dashboard/members/print" className="btn-pill bg-paper text-ink">{c.print}</Link>
      </div>

      {query.problem && (
        <p role="alert" className="mt-5 inline-block rounded-xl border-2 border-ink bg-arcade-fuel px-4 py-2 font-bold text-ink">
          {c.problem(errorText(query.problem))}
        </p>
      )}
      {query.added !== undefined && (
        <p role="status" className="mt-5 inline-block rounded-xl border-2 border-ink bg-arcade-mint px-4 py-2 font-bold text-ink">
          {c.rosterResult(count(query.added), count(query.skipped), count(query.already))}
        </p>
      )}

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        <form action={addMemberAction} className="card space-y-4 p-5">
          <h2 className="text-2xl">{c.addTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="firstName">{c.firstName}</label>
              <input id="firstName" name="firstName" className="field" maxLength={60} required />
            </div>
            <div>
              <label className="label" htmlFor="lastName">{c.lastName}</label>
              <input id="lastName" name="lastName" className="field" maxLength={60} />
            </div>
            <div>
              <label className="label" htmlFor="subteamId">{c.subteam}</label>
              <select id="subteamId" name="subteamId" className="field">{subteamOptions}</select>
            </div>
            {captain && (
              <div>
                <label className="label" htmlFor="role">{c.role}</label>
                <select id="role" name="role" className="field" defaultValue="member">{roleOptions}</select>
              </div>
            )}
          </div>
          <button type="submit" className="btn-pill bg-arcade-purple text-paper !shadow-none">{c.add}</button>
        </form>

        <form action={rosterAction} className="card space-y-3 p-5">
          <label className="block font-display text-2xl" htmlFor="roster">{c.rosterTitle}</label>
          <p className="text-sm text-ink/70">{c.rosterHelp}</p>
          <textarea id="roster" name="roster" rows={4} className="field" />
          <div>
            <label className="label" htmlFor="rosterFile">{c.rosterFile}</label>
            <input id="rosterFile" name="file" type="file" accept=".csv,.txt,text/csv,text/plain" className="block w-full min-w-0 max-w-full text-sm" />
          </div>
          <button type="submit" className="btn-pill bg-paper text-ink !shadow-none">{c.rosterSubmit}</button>
        </form>
      </div>

      <section className="card mt-6 p-5">
        <h2 className="text-2xl">{c.subteamsTitle}</h2>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {subteams.map((s) => (
            <li key={s.id} data-subteam={s.name} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-bold">{s.name}</span>
              <span className="text-sm text-ink/70">{c.subteamUse(s.members, s.tasks)}</span>
              {s.members === 0 && s.tasks === 0 && (
                <form action={removeSubteamAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="btn-small">{c.subteamRemove(s.name)}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <form action={addSubteamAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label className="label" htmlFor="subteamName">{c.subteamName}</label>
            <input id="subteamName" name="name" className="field" maxLength={60} required />
          </div>
          <button type="submit" className="btn-pill bg-paper text-ink !shadow-none">{c.subteamAdd}</button>
        </form>
      </section>

      <h2 className="mt-10 text-3xl">{c.listTitle(members.length)}</h2>
      <p className="mt-1 text-sm text-paper/70">{c.rekeyNote}{!captain && ` ${c.captainOnly}`}</p>
      <ul className="mt-4 space-y-3">
        {members.map((m) => {
          const fullName = `${m.firstName} ${m.lastName}`.trim();
          const self = m.id === lead.id;
          // A lead looks after members and their own record. A captain looks after everyone.
          const mine = captain || m.role === 'member' || self;
          return (
            <li key={m.id} data-member-name={fullName} className={`rounded-xl border-2 bg-deep p-4 ${m.active ? 'border-paper/30' : 'border-paper/15 text-paper/60'}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 break-words">
                  <span className="text-lg font-bold">{fullName}</span>
                  <span className="ml-3 text-sm text-paper/70">{m.subteamName ?? c.noSubteam}</span>
                </p>
                <p className="flex flex-wrap items-center gap-2">
                  {m.role !== 'member' && <span className="chip !bg-arcade-sky">{roleLabel[m.role]}</span>}
                  {m.hasLogin && <span className="chip">{c.hasLogin}</span>}
                  {!m.active && <span className="chip !border-arcade-bumper !bg-arcade-bumper !text-paper">{c.inactive}</span>}
                </p>
              </div>
              {mine && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {m.active && <CopyLink path={`/m/${m.pageKey}`} />}
                  {(['new-code', 'new-link', m.active ? 'deactivate' : 'reactivate'] as const).map((what) =>
                    what === 'deactivate' && self ? null : (
                      <form key={what} action={memberRowAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="what" value={what} />
                        <button type="submit" className="btn-small">
                          {what === 'new-code' ? c.newCode : what === 'new-link' ? c.newLink : what === 'deactivate' ? c.deactivate : c.reactivate}
                        </button>
                      </form>
                    ),
                  )}
                  {captain && m.active && m.role !== 'member' && <InviteButton memberId={m.id} />}
                </div>
              )}
              {mine && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-bold underline underline-offset-4">{c.edit}</summary>
                  <form action={editMemberAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="firstName" aria-label={`${c.firstName}: ${fullName}`} className="field" defaultValue={m.firstName} maxLength={60} required />
                    <input name="lastName" aria-label={`${c.lastName}: ${fullName}`} className="field" defaultValue={m.lastName} maxLength={60} />
                    <select name="subteamId" aria-label={`${c.subteam}: ${fullName}`} className="field" defaultValue={m.subteamId ?? ''}>{subteamOptions}</select>
                    {captain && !self ? (
                      <select name="role" aria-label={`${c.role}: ${fullName}`} className="field" defaultValue={m.role}>{roleOptions}</select>
                    ) : (
                      <span />
                    )}
                    <button type="submit" className="btn-small">{c.save}</button>
                  </form>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
