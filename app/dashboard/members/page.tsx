import Link from 'next/link';
import {
  addMemberAction,
  addSubteamAction,
  removeSubteamAction,
  rosterAction,
} from '@/app/dashboard/members/actions';
import { groupColour, NO_GROUP_COLOUR, PersonFigure } from '@/components/dashboard/PersonFigure';
import { WalletNote } from '@/components/dashboard/WalletNote';
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
  // Leads and captains first, then each subteam, then people with none, then anyone turned off.
  type Row = (typeof members)[number];
  const groups: { key: string; name: string; colour: string; people: Row[] }[] = [];
  const active = members.filter((m) => m.active);
  const leaders = active.filter((m) => m.role !== 'member');
  if (leaders.length) groups.push({ key: 'leads', name: c.groupLeads, colour: '#FFD23F', people: leaders });
  for (const s of subteams) {
    const people = active.filter((m) => m.role === 'member' && m.subteamId === s.id);
    if (people.length) groups.push({ key: s.id, name: s.name, colour: groupColour(s.name, subteams.map((t) => t.name)), people });
  }
  const loose = active.filter((m) => m.role === 'member' && !m.subteamId);
  if (loose.length) groups.push({ key: 'none', name: c.groupNone, colour: NO_GROUP_COLOUR, people: loose });
  const off = members.filter((m) => !m.active);
  if (off.length) groups.push({ key: 'off', name: c.groupInactive, colour: NO_GROUP_COLOUR, people: off });
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
      <p className="mt-1 text-sm text-paper/70">{c.boardHelp}</p>
      <div data-testid="member-board" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <section key={g.key} data-group={g.name} className="min-w-0 rounded-xl border-2 border-paper/20 bg-deep p-4">
            <h3 className="flex items-center gap-2 text-xl">
              <span className="inline-block h-3.5 w-3.5 rounded" style={{ background: g.colour }} />
              {g.name}
              <span className="ml-auto text-sm font-semibold text-paper/60">{g.people.length}</span>
            </h3>
            <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-3">
              {g.people.map((m) => {
                const fullName = `${m.firstName} ${m.lastName}`.trim();
                return (
                  <li key={m.id} className="w-[5.5rem]">
                    <Link
                      href={`/dashboard/members/${m.id}`}
                      data-member-name={fullName}
                      className={`grid justify-items-center gap-1 rounded-lg px-1 py-1.5 text-center hover:bg-paper/10 ${m.active ? '' : 'opacity-50'}`}
                    >
                      <PersonFigure firstName={m.firstName} lastName={m.lastName} colour={groupColour(m.subteamName, subteams.map((t) => t.name))} ringed={m.role !== 'member'} />
                      <span className="text-xs font-semibold leading-tight [overflow-wrap:anywhere]">{fullName}</span>
                      {m.role !== 'member' && <span className="text-[10px] font-bold uppercase tracking-wide text-arcade-fuel">{roleLabel[m.role]}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-10 max-w-2xl">
        <WalletNote />
      </div>
    </>
  );
}
