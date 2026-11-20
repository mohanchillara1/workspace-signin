import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { memberCountAction } from '@/app/m/[key]/inventory/actions';
import { ItemPicture } from '@/components/inventory/ItemPicture';
import { clientAddress } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { errorText } from '@/lib/errors';
import { addressMayUseInventory, listInventory, memberMayUseInventory, membersSeeInventory } from '@/lib/inventory';
import { memberByPageKey } from '@/lib/members';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.member.homeScreenName };

// The inventory as a member sees it: every item the team has, with its count,
// and a way to add to a count or take from it. Nothing else can be changed here.
export default async function MemberInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ problem?: string; g?: string }>;
}) {
  const { key } = await params;
  const { problem, g } = await searchParams;
  const db = getDb();
  const now = new Date();
  const slow = (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl">{copy.app.tooManyTitle}</h1>
      <p className="mt-3 text-lg text-paper/85">{copy.app.tooManyBody}</p>
    </main>
  );
  // One ceiling for the address before anyone is looked up, one for the member after.
  // Every Add or Take brings this page back, so the ceilings are well above a member's own page's.
  if (!(await addressMayUseInventory(db, await clientAddress(), now))) return slow;
  const member = await memberByPageKey(db, key);
  if (!member || !(await membersSeeInventory(db))) notFound();
  if (!(await memberMayUseInventory(db, member.id, now))) return slow;
  const items = (await listInventory(db)).filter((item) => item.have);
  const groups = [...new Set(items.map((item) => item.category))];
  const c = copy.inventory;

  return (
    <main className="mx-auto max-w-md px-4 pb-12 pt-8">
      <Link href={`/m/${key}`} className="text-sm font-bold underline underline-offset-4">← {c.memberBack}</Link>
      <h1 className="mt-4 text-4xl">{c.title}</h1>
      <p className="mt-2 text-paper/85">{c.memberHelp}</p>
      {problem && (
        <p role="alert" className="mt-5 inline-block rounded-xl border-2 border-ink bg-arcade-fuel px-4 py-2 font-bold text-ink">
          {c.problem(errorText(problem))}
        </p>
      )}
      {items.length === 0 && <p className="mt-8 text-paper/70">{c.empty}</p>}
      {/* A long list on a phone: each group stays folded until it is tapped, or until something in it was just changed. */}
      {groups.map((group) => (
        <details key={group} data-inventory-group={group} open={g === group} className="mt-4 rounded-xl border-2 border-paper/25 px-4 py-3">
          <summary className="cursor-pointer text-xl font-bold">{c.groupCount(group, items.filter((item) => item.category === group).length)}</summary>
          <ul className="mt-3 space-y-3">
            {items.filter((item) => item.category === group).map((item) => (
              <li key={item.id} id={`i-${item.id}`} data-item={item.name} className="card scroll-mt-6 space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <ItemPicture itemId={item.id} category={item.category} photoVersion={item.photoVersion} size={64} />
                  <div className="min-w-0">
                    <p className="font-bold [overflow-wrap:anywhere]">{item.name}</p>
                    <p data-testid="item-count" className={item.count === null ? 'text-sm text-ink/70' : 'font-display text-3xl'}>
                      {item.count === null ? c.notCounted : item.count}
                    </p>
                  </div>
                </div>
                <form action={memberCountAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="key" value={key} />
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="group" value={group} />
                  <div className="w-24">
                    <label className="label" htmlFor={`n-${item.id}`}>{c.amount}</label>
                    <input id={`n-${item.id}`} name="amount" className="field" inputMode="numeric" pattern="[0-9]*" maxLength={5} defaultValue="1" required />
                  </div>
                  <button type="submit" name="what" value="put" className="btn-small">{c.put}</button>
                  <button type="submit" name="what" value="take" className="btn-small">{c.take}</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </main>
  );
}
