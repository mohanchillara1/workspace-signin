import Link from 'next/link';
import { notFound } from 'next/navigation';
import { editMemberAction, memberRowAction, setSlackIdAction } from '@/app/dashboard/members/actions';
import { CopyLink, InviteButton } from '@/components/dashboard/MemberBits';
import { groupColour, PersonFigure } from '@/components/dashboard/PersonFigure';
import { memberCount } from '@/lib/attendance';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { errorText } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { listMembers, listSubteams } from '@/lib/members';
import { qrSvg } from '@/lib/qr';
import { standingFor } from '@/lib/submit';
import { openFor } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ problem?: string; slack?: string }>;
}) {
  const lead = await requireLead();
  const { id } = await params;
  const { problem, slack } = await searchParams;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const [all, subteams] = await Promise.all([listMembers(db), listSubteams(db)]);
  const m = all.find((row) => row.id === id);
  if (!m) notFound();

  const today = chicagoDay(new Date());
  const [svg, tasks, count, sentIn] = await Promise.all([
    qrSvg(m.scanCode),
    openFor(db, m.id, today),
    memberCount(db, m.id, today),
    standingFor(db, m.id),
  ]);

  const c = copy.members;
  const captain = lead.role === 'captain';
  const self = m.id === lead.id;
  // A lead looks after members and their own record. A captain looks after everyone.
  const mine = captain || m.role === 'member' || self;
  const roleLabel = { member: c.roleMember, lead: c.roleLead, captain: c.roleCaptain };
  const fullName = `${m.firstName} ${m.lastName}`.trim();
  const colour = groupColour(m.subteamName, subteams.map((t) => t.name));
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
  const sc = copy.slack;
  const slackNotes: Record<string, { text: string; bad: boolean }> = {
    saved: { text: sc.idSaved, bad: false },
    cleared: { text: sc.idCleared, bad: false },
    shape: { text: sc.idBadShape, bad: true },
    taken: { text: sc.idTaken, bad: true },
  };
  const s = copy.submit;
  const standingLabel = { waiting: s.waiting, approved: s.approved, sent_back: s.sentBack };

  return (
    <div data-member-name={fullName}>
      <Link href="/dashboard/members" className="text-sm font-bold underline underline-offset-4">← {c.back}</Link>

      {problem && (
        <p role="alert" className="mt-5 inline-block rounded-xl border-2 border-ink bg-arcade-fuel px-4 py-2 font-bold text-ink">
          {c.problem(errorText(problem))}
        </p>
      )}

      {slack && Object.hasOwn(slackNotes, slack) && (
        <p role={slackNotes[slack].bad ? 'alert' : 'status'} className={`mt-5 inline-block rounded-xl border-2 border-ink px-4 py-2 font-bold text-ink ${slackNotes[slack].bad ? 'bg-arcade-fuel' : 'bg-arcade-mint'}`}>
          {slackNotes[slack].text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <PersonFigure firstName={m.firstName} lastName={m.lastName} colour={colour} ringed={m.role !== 'member'} size={72} />
        <div className="min-w-0">
          <h1 className="text-4xl sm:text-5xl [overflow-wrap:anywhere]">{fullName}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <span className="chip" style={{ background: colour }}>{m.subteamName ?? c.noSubteam}</span>
            {m.role !== 'member' && <span className="chip !bg-arcade-sky">{roleLabel[m.role]}</span>}
            {m.slackUserId && <span className="chip">{sc.linkedChip}</span>}
            {m.hasLogin && <span className="chip">{c.hasLogin}</span>}
            {!m.active && <span className="chip !border-arcade-bumper !bg-arcade-bumper !text-paper">{c.inactive}</span>}
          </p>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="card space-y-3 p-5">
          <div
            data-testid="member-qr"
            role="img"
            aria-label={c.detailQrAlt(fullName)}
            className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="font-bold">{c.detailCode}</dt>
              <dd data-testid="scan-code" className="break-all font-mono">{m.scanCode}</dd>
            </div>
            <div>
              <dt className="font-bold">{c.detailId}</dt>
              <dd className="break-all font-mono text-ink/70">{m.id}</dd>
            </div>
          </dl>
          <p className="text-sm">
            {count.meetingDays === 0
              ? copy.member.countNone(dayLabel(count.since))
              : copy.member.count(count.attended, count.meetingDays, dayLabel(count.since))}
          </p>
        </section>

        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="text-2xl">{c.detailTasks}</h2>
            {tasks.length === 0 ? (
              <p className="mt-2 text-paper/70">{c.detailNoTasks}</p>
            ) : (
              <ul data-testid="member-tasks" className="mt-3 space-y-2">
                {tasks.map((t) => (
                  <li key={t.key} className="rounded-xl border-2 border-paper/20 bg-deep px-4 py-3">
                    <p className="font-bold [overflow-wrap:anywhere]">{t.title}</p>
                    <p className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span className="chip">{c.taskGroup[t.group]}</span>
                      {t.state === 'sent_back' && <span className="chip !bg-arcade-bumper !text-paper">{c.taskSentBack}</span>}
                      {t.state === 'claimed' && <span className="chip">{c.taskTaken}</span>}
                      {t.dueDay && <span className={`chip ${t.overdue ? '!bg-arcade-bumper !text-paper' : ''}`}>{c.taskDue(dayLabel(t.dueDay))}</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-2xl">{c.detailSentIn}</h2>
            {sentIn.length === 0 ? (
              <p className="mt-2 text-paper/70">{c.detailNoSentIn}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {sentIn.map((row) => (
                  <li key={row.assignmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-paper/20 bg-deep px-4 py-3">
                    <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{row.title}</span>
                    <span className="chip">{standingLabel[row.state]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {mine && (
            <section className="rounded-xl border-2 border-paper/20 bg-deep p-4">
              <h2 className="text-2xl">{c.detailManage}</h2>
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
              <p className="mt-2 text-sm text-paper/70">{c.rekeyNote}</p>
              <form action={editMemberAction} className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-end">
                <input type="hidden" name="id" value={m.id} />
                <div>
                  <label className="label" htmlFor="editFirst">{c.firstName}</label>
                  <input id="editFirst" name="firstName" className="field" defaultValue={m.firstName} maxLength={60} required />
                </div>
                <div>
                  <label className="label" htmlFor="editLast">{c.lastName}</label>
                  <input id="editLast" name="lastName" className="field" defaultValue={m.lastName} maxLength={60} />
                </div>
                <div>
                  <label className="label" htmlFor="editSubteam">{c.subteam}</label>
                  <select id="editSubteam" name="subteamId" className="field" defaultValue={m.subteamId ?? ''}>{subteamOptions}</select>
                </div>
                {captain && !self && (
                  <div>
                    <label className="label" htmlFor="editRole">{c.role}</label>
                    <select id="editRole" name="role" className="field" defaultValue={m.role}>{roleOptions}</select>
                  </div>
                )}
                <button type="submit" className="btn-pill bg-arcade-purple text-paper !shadow-none sm:col-span-2 sm:justify-self-start">{c.save}</button>
              </form>
              <form action={setSlackIdAction} className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
                <input type="hidden" name="id" value={m.id} />
                <div>
                  <label className="label !text-paper" htmlFor="slackUserId">{sc.idLabel}</label>
                  <input id="slackUserId" name="slackUserId" className="field" defaultValue={m.slackUserId ?? ''} maxLength={30} autoComplete="off" spellCheck={false} />
                </div>
                <button type="submit" className="btn-small">{sc.idSave}</button>
                <p className="text-sm text-paper/70 sm:col-span-2">{sc.idHelp}</p>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
