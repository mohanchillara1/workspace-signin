import type { Metadata } from 'next';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, chicagoTime, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { reviewQueue } from '@/lib/review';
import { ReviewActions } from './ReviewActions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `${copy.review.title} | ${copy.app.title}` };

/** Only a link that starts with https:// is tappable. Anything else is shown as text. */
const isSafeLink = (link: string) => /^https:\/\//i.test(link.trim());

export default async function ReviewPage() {
  await requireLead();
  const rows = await reviewQueue(getDb());
  const r = copy.review;
  const via = { kiosk: r.viaKiosk, member_page: r.viaMemberPage, lead: r.viaLead, slack: r.viaSlack };
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-5xl">{r.title}</h1>
        {rows.length > 0 && <p data-testid="review-count" className="text-lg font-bold text-arcade-fuel">{r.waitingCount(rows.length)}</p>}
      </div>
      <p className="mt-2 text-paper/70">{r.help}</p>

      {rows.length === 0 ? (
        <div data-testid="review-empty" className="mt-8 max-w-xl rounded-xl border-2 border-paper/30 bg-deep p-5">
          <p className="text-lg font-bold">{r.emptyTitle}</p>
          <p className="mt-1 text-paper/80">{r.emptyBody}</p>
        </div>
      ) : (
        <ul className="mt-8 space-y-5">
          {rows.map((row) => (
            <li key={row.assignmentId} data-testid="review-card" data-assignment={row.assignmentId} className="card p-5">
              <h2 className="font-sans text-2xl font-bold tracking-normal">{row.title}</h2>
              <p className="mt-1 text-sm text-ink/70">
                {r.sentBy(row.member, dayLabel(chicagoDay(row.at)), chicagoTime(row.at))}, {via[row.via]}
              </p>
              {row.round > 1 && (
                <p data-testid="review-round" className="mt-3 rounded-lg border-2 border-ink bg-arcade-sky px-3 py-2">
                  <span className="chip mr-2">{r.secondTry(row.round)}</span>
                  {row.lastComment && (
                    <span className="whitespace-pre-wrap break-words">
                      <span className="font-bold">{r.lastComment}: </span>
                      {row.lastComment}
                    </span>
                  )}
                </p>
              )}

              <dl className="mt-4 space-y-3">
                <div>
                  <dt className="label">{r.noteLabel}</dt>
                  {/* Plain text only. React escapes it; the style keeps the member's line breaks. */}
                  <dd className="whitespace-pre-wrap break-words" data-testid="review-note">
                    {row.note.trim() === '' ? <span className="text-ink/60">{r.noNote}</span> : row.note}
                  </dd>
                </div>
                <div>
                  <dt className="label">{r.linkLabel}</dt>
                  <dd className="break-all" data-testid="review-link">
                    {row.link.trim() === '' ? (
                      <span className="text-ink/60">{r.noLink}</span>
                    ) : isSafeLink(row.link) ? (
                      <a href={row.link.trim()} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-arcade-purple underline">
                        {row.link}
                      </a>
                    ) : (
                      <>
                        <span>{row.link}</span>
                        <span className="mt-1 block text-sm text-ink/70">{r.linkUnsafe}</span>
                      </>
                    )}
                  </dd>
                </div>
              </dl>

              <ReviewActions assignmentId={row.assignmentId} title={row.title} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
