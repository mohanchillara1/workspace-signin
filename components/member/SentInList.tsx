import { copy } from '@/lib/copy';
import type { Standing } from '@/lib/submit';

const STATE_CHIP: Record<Standing['state'], string> = {
  waiting: '',
  approved: '!bg-arcade-mint',
  sent_back: '!border-arcade-bumper !bg-arcade-bumper !text-paper',
};

/** Only a link that starts with https:// is ever made tappable. */
function Link({ href }: { href: string }) {
  if (!href.startsWith('https://')) return <span className="break-all">{href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold underline underline-offset-4">
      {href}
    </a>
  );
}

/** Where each of the member's submissions stands. Notes and comments are text, never HTML. */
export function SentInList({ rows }: { rows: Standing[] }) {
  const s = copy.submit;
  const label: Record<Standing['state'], string> = { waiting: s.waiting, approved: s.approved, sent_back: s.sentBack };
  return (
    <section data-testid="sent-in" aria-labelledby="sent-in-title" className="mt-10">
      <h2 id="sent-in-title" className="mb-3 text-2xl">{s.listTitle}</h2>
      {rows.length === 0 ? (
        <div className="card p-4">
          <p>{s.listNone}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li key={`${row.assignmentId}-${index}`} data-state={row.state} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <h3 className="min-w-0 break-words font-display text-lg leading-tight">{row.title}</h3>
                <span className={`chip ${STATE_CHIP[row.state]}`}>{label[row.state]}</span>
              </div>
              {row.note && (
                <p className="mt-2 whitespace-pre-wrap break-words text-base">
                  <span className="font-bold">{s.yourNote}: </span>
                  {row.note}
                </p>
              )}
              {row.link && (
                <p className="mt-2 text-base">
                  <span className="font-bold">{s.yourLink}: </span>
                  <Link href={row.link} />
                </p>
              )}
              {row.comment && (
                <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border-2 border-ink bg-white px-3 py-2 text-base">
                  <span className="font-bold">{s.leadComment}: </span>
                  {row.comment}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
