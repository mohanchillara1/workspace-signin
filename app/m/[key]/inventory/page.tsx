import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { memberAddAction, memberAsideAction, memberCountAction } from '@/app/m/[key]/inventory/actions';
import { GroupPicture, ItemPicture } from '@/components/inventory/ItemPicture';
import { clientAddress } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { errorText } from '@/lib/errors';
import { addressMayUseInventory, listInventory, memberMayUseInventory, membersSeeInventory } from '@/lib/inventory';
import { memberByPageKey } from '@/lib/members';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.member.homeScreenName };

// The inventory as a member sees it: every item the team has, with its count,
// a way to add to a count or take from it, and, inside a group, a way to add an
// item that group is missing or take one off the list. Photos stay a lead's.
export default async function MemberInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ problem?: string; g?: string; note?: string }>;
}) {
  const { key } = await params;
  const { problem, g, note } = await searchParams;
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
  const have = (await listInventory(db)).filter((item) => item.have);
  const groups = [...new Set(have.map((item) => item.category))];
  const group = groups.find((name) => name === g) ?? null;
  const items = have.filter((item) => item.category === group);
  const c = copy.inventory;

  // One tile for each group first. A tile shows that group's items and nothing else.
  return (
    <main className="mx-auto max-w-md px-4 pb-12 pt-8">
      {group === null ? (
        <Link href={`/m/${key}`} className="text-sm font-bold underline underline-offset-4">← {c.memberBack}</Link>
      ) : (
        <Link href={`/m/${key}/inventory`} className="text-sm font-bold underline underline-offset-4">← {c.allGroups}</Link>
      )}
      <h1 className="mt-4 text-4xl">{group ?? c.title}</h1>
      {problem && (
        <p role="alert" className="mt-5 inline-block rounded-xl border-2 border-ink bg-arcade-fuel px-4 py-2 font-bold text-ink">
          {c.problem(errorText(problem))}
        </p>
      )}
      {!problem && note === 'aside' && (
        <p role="status" className="mt-5 inline-block rounded-xl border-2 border-ink bg-arcade-mint px-4 py-2 font-bold text-ink">
          {c.memberAsideDone}
        </p>
      )}
      {group === null ? (
        have.length === 0 ? (
          <p className="mt-8 text-paper/70">{c.empty}</p>
        ) : (
          <>
            <p className="mt-2 text-paper/85">{c.pickGroup}</p>
            <ul data-testid="inventory-tiles" className="mt-5 grid grid-cols-2 gap-3">
              {groups.map((name) => (
                <li key={name}>
                  <Link href={`/m/${key}/inventory?g=${encodeURIComponent(name)}`} data-tile={name} className="card flex h-full min-w-0 flex-col gap-2 p-3">
                    <GroupPicture category={name} />
                    <span className="font-display text-lg leading-tight [overflow-wrap:anywhere]">{name}</span>
                    <span className="text-sm text-ink/70">{c.tileItems(have.filter((item) => item.category === name).length)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <section data-inventory-group={group}>
          <p className="mt-2 text-paper/85">{c.memberHelp}</p>
          <ul className="mt-5 space-y-3">
            {items.map((item) => (
              <li key={item.id} id={`i-${item.id}`} data-item={item.name} className="card scroll-mt-6 space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <ItemPicture itemId={item.id} category={item.category} photoVersion={item.photoVersion} size={72} />
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
                {/* Asks once: the first tap opens the real button. */}
                <details data-testid="member-aside" className="text-sm">
                  <summary className="cursor-pointer font-bold underline underline-offset-4">{c.memberAside}</summary>
                  <form action={memberAsideAction} className="mt-2 space-y-2">
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="group" value={group} />
                    <p className="text-ink/70">{c.memberAsideHelp}</p>
                    <button type="submit" className="btn-small">{c.memberAsideConfirm}</button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
          <form id="add" action={memberAddAction} data-testid="member-add-item" className="card mt-8 scroll-mt-6 space-y-3 p-4">
            <h2 className="text-2xl">{c.memberAddTitle}</h2>
            <p className="text-sm text-ink/70">{c.memberAddHelp}</p>
            <input type="hidden" name="key" value={key} />
            <input type="hidden" name="group" value={group} />
            <div>
              <label className="label" htmlFor="new-name">{c.name}</label>
              <input id="new-name" name="name" className="field" maxLength={80} autoComplete="off" required />
            </div>
            <div className="w-40">
              <label className="label" htmlFor="new-count">{c.startCount}</label>
              <input id="new-count" name="count" className="field" inputMode="numeric" pattern="[0-9]*" maxLength={5} />
            </div>
            <button type="submit" className="btn-small">{c.memberAddButton}</button>
          </form>
        </section>
      )}
    </main>
  );
}
