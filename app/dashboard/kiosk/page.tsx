import { pairThisDevice, unpairDevice } from '@/app/dashboard/kiosk/actions';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, chicagoTime, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { listKiosks } from '@/lib/kiosk';
import { kioskDimMinutes } from '@/lib/kiosk-wall';

export const dynamic = 'force-dynamic';

export default async function KioskAdminPage() {
  await requireLead();
  const kiosks = await listKiosks(getDb());
  const c = copy.kioskAdmin;
  return (
    <>
      <h1 className="text-5xl">{c.title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-paper/80">{c.body}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <form action={pairThisDevice} className="card space-y-4 p-5">
          <h2 className="text-2xl">{c.pairTitle}</h2>
          <p className="text-sm text-ink/75">{c.pairHelp}</p>
          <div>
            <label className="label" htmlFor="name">{c.name}</label>
            <input id="name" name="name" className="field" maxLength={60} placeholder={c.namePlaceholder} required />
          </div>
          <button type="submit" className="btn-pill bg-arcade-fuel text-ink !shadow-none">{c.pair}</button>
        </form>

        <section className="rounded-xl border-2 border-ink bg-arcade-sky p-5 text-ink shadow-hard">
          <h2 className="text-2xl">{c.setupTitle}</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6">
            {c.setup.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      </div>

      <section className="card mt-6 max-w-3xl p-5">
        <h2 className="text-2xl">{c.byItselfTitle}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          {c.byItself(kioskDimMinutes()).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <h2 className="mt-10 text-3xl">{c.listTitle}</h2>
      {kiosks.length === 0 ? (
        <p className="mt-3 text-paper/80">{c.none}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {kiosks.map((kiosk) => (
            <li key={kiosk.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 bg-deep p-4 ${kiosk.revokedAt ? 'border-paper/15 text-paper/55' : 'border-paper/30'}`}>
              <p>
                <span className="text-lg font-bold">{kiosk.name}</span>
                <span className="ml-3 text-sm text-paper/70">
                  {kiosk.lastSeenAt ? c.lastSeen(`${dayLabel(chicagoDay(kiosk.lastSeenAt))} ${chicagoTime(kiosk.lastSeenAt)}`) : c.neverSeen}
                </span>
              </p>
              {kiosk.revokedAt ? (
                <span className="chip">{c.unpaired}</span>
              ) : (
                <form action={unpairDevice}>
                  <input type="hidden" name="id" value={kiosk.id} />
                  <button type="submit" className="btn-small">{c.unpair(kiosk.name)}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
