import { reopenFinished } from '@/app/dashboard/tasks/actions';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, chicagoTime, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { approvals } from '@/lib/review';
import { finished } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

export default async function FinishedPage() {
  await requireLead();
  const db = getDb();
  const rows = await finished(db, { limit: 200 });
  // Work a lead approved says so, with who and when.
  const approved = await approvals(db, rows.map((row) => row.assignmentId));
  const f = copy.finished;
  const r = copy.review;
  const approvedLine = (a: { by: string; at: Date | null }) =>
    a.by && a.at ? r.approvedBy(a.by, dayLabel(chicagoDay(a.at)), chicagoTime(a.at)) : r.approvedByLead;
  const via = { kiosk: f.viaKiosk, member_page: f.viaMemberPage, lead: f.viaLead };
  return (
    <>
      <h1 className="text-5xl">{f.title}</h1>
      <p className="mt-2 text-paper/70">{f.help}</p>
      {rows.length === 0 ? (
        <p className="mt-8 text-lg text-paper/80">{f.empty}</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {rows.map((row) => (
            <li key={row.assignmentId} data-testid="finished-row" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border-2 border-paper/30 bg-deep p-4">
              <div className="min-w-0">
                <h2 className="font-sans text-xl font-bold tracking-normal">{row.title}</h2>
                <p className="mt-1 text-sm text-paper/70">
                  {f.by(row.doneByFull, dayLabel(chicagoDay(row.doneAt)), chicagoTime(row.doneAt))}, {via[row.doneVia]}
                </p>
                {approved.has(row.assignmentId) && (
                  <p data-testid="approved-line" className="mt-1 text-sm font-bold text-arcade-mint">
                    {approvedLine(approved.get(row.assignmentId)!)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {approved.has(row.assignmentId) ? (
                  <span data-testid="approved-chip" className="chip !bg-arcade-mint">{r.approvedChip}</span>
                ) : null}
                {row.canReopen ? (
                  <form action={reopenFinished}>
                    <input type="hidden" name="assignmentId" value={row.assignmentId} />
                    <button type="submit" className="btn-small">{f.reopen}</button>
                  </form>
                ) : (
                  <span className="chip">{f.taskClosed}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
