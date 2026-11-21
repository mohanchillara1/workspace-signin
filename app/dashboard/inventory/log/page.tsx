import Link from 'next/link';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoDay, chicagoTime, dayLabel } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { inventoryLog } from '@/lib/inventory';

export const dynamic = 'force-dynamic';

// Who changed which count or which item, and when. Full names are on it, so it needs a lead's login.
export default async function InventoryLogPage() {
  await requireLead();
  const rows = await inventoryLog(getDb(), { limit: 500 });
  const c = copy.inventory;
  return (
    <>
      <Link href="/dashboard/inventory" className="text-sm font-bold underline underline-offset-4">← {c.back}</Link>
      <h1 className="mt-4 text-5xl">{c.logTitle}</h1>
      <p className="mt-2 text-paper/70">{c.logHelp}</p>
      {rows.length === 0 ? (
        <p className="mt-8 text-paper/70">{c.logEmpty}</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border-2 border-paper/20">
          <table data-testid="inventory-log" className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-deep text-paper/70">
              <tr>
                {[c.logWhen, c.logWho, c.logItem, c.logWhat, c.logAfter].map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-3 font-bold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t-2 border-paper/10">
                  <td className="whitespace-nowrap px-4 py-3">{dayLabel(chicagoDay(row.at))} {chicagoTime(row.at)}</td>
                  <td className="px-4 py-3">{row.who || c.byScript}</td>
                  <td className="px-4 py-3">{row.item}</td>
                  <td className="px-4 py-3 font-bold">
                    {row.change === 'put'
                      ? c.logPut(row.amount ?? 0)
                      : row.change === 'take'
                        ? c.logTake(row.amount ?? 0)
                        : row.change === 'count'
                          ? c.logCount
                          : row.change === 'added'
                            ? c.logAdded
                            : row.change === 'back'
                              ? c.logBack
                              : c.logAside}
                  </td>
                  {/* Only a change of a count has a count after it. */}
                  <td className="px-4 py-3">{['put', 'take', 'count'].includes(row.change) ? (row.to === null ? c.notCounted : row.to) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
