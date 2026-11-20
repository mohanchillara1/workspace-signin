import Link from 'next/link';
import { addItemAction, countAction, haveAction, membersAction } from '@/app/dashboard/inventory/actions';
import { GroupPicture, ItemPicture } from '@/components/inventory/ItemPicture';
import { PhotoPicker } from '@/components/inventory/PhotoPicker';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { errorText } from '@/lib/errors';
import { INVENTORY_CATEGORIES, listInventory, membersSeeInventory } from '@/lib/inventory';

export const dynamic = 'force-dynamic';

// The page opens on one tile for each group. A tile shows that group's items and nothing else,
// so nobody is handed two hundred cards at once, least of all on a phone.
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ problem?: string; g?: string }> }) {
  const lead = await requireLead();
  const { problem, g } = await searchParams;
  const db = getDb();
  const [all, open] = await Promise.all([listInventory(db), membersSeeInventory(db)]);
  const c = copy.inventory;
  const have = all.filter((item) => item.have);
  const groups = [...new Set(all.map((item) => item.category))];
  const group = groups.find((name) => name === g) ?? null;
  const items = have.filter((item) => item.category === group);
  const aside = all.filter((item) => !item.have && item.category === group);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl">{c.title}</h1>
        <Link href="/dashboard/inventory/log" className="btn-pill bg-paper text-ink">{c.logLink}</Link>
      </div>
      <p data-testid="inventory-summary" className="mt-2 text-lg text-paper/70">{c.summary(have.length, have.filter((item) => item.count === null).length)}</p>

      {problem && (
        <p role="alert" className="mt-5 inline-block rounded-xl border-2 border-ink bg-arcade-fuel px-4 py-2 font-bold text-ink">
          {c.problem(errorText(problem))}
        </p>
      )}

      {group === null ? (
        <>
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
            <form action={addItemAction} className="card space-y-4 p-5">
              <h2 className="text-2xl">{c.addTitle}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="itemName">{c.name}</label>
                  <input id="itemName" name="name" className="field" maxLength={80} required />
                </div>
                <div>
                  <label className="label" htmlFor="itemGroup">{c.group}</label>
                  <select id="itemGroup" name="category" className="field">
                    {INVENTORY_CATEGORIES.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="itemCount">{c.startCount}</label>
                  <input id="itemCount" name="count" className="field" inputMode="numeric" pattern="[0-9]*" maxLength={5} />
                </div>
              </div>
              <button type="submit" className="btn-pill bg-arcade-purple text-paper !shadow-none">{c.add}</button>
            </form>

            <section data-testid="members-switch" className="card space-y-3 p-5">
              <p className="font-bold">{open ? c.membersOn : c.membersOff}</p>
              {lead.role === 'captain' && (
                <form action={membersAction}>
                  <input type="hidden" name="on" value={open ? '0' : '1'} />
                  <button type="submit" className="btn-pill bg-paper text-ink !shadow-none">{open ? c.turnOff : c.turnOn}</button>
                </form>
              )}
            </section>
          </div>

          {all.length === 0 ? (
            <p className="mt-8 text-paper/70">{c.empty}</p>
          ) : (
            <>
              <p className="mt-10 text-paper/70">{c.pickGroup}</p>
              <ul data-testid="inventory-tiles" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {groups.map((name) => {
                  const inGroup = have.filter((item) => item.category === name);
                  const setAside = all.filter((item) => !item.have && item.category === name).length;
                  const uncounted = inGroup.filter((item) => item.count === null).length;
                  return (
                    <li key={name}>
                      <Link href={`/dashboard/inventory?g=${encodeURIComponent(name)}`} data-tile={name} className="card flex h-full min-w-0 flex-col gap-2 p-4 hover:-translate-y-0.5">
                        <GroupPicture category={name} />
                        <span className="font-display text-xl leading-tight [overflow-wrap:anywhere]">{name}</span>
                        <span className="text-sm text-ink/70">
                          {c.tileItems(inGroup.length)}
                          {uncounted > 0 && <span className="block">{c.tileNotCounted(uncounted)}</span>}
                          {setAside > 0 && <span className="block">{c.tileAside(setAside)}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      ) : (
        <section data-inventory-group={group} className="mt-8">
          <Link href="/dashboard/inventory" className="text-sm font-bold underline underline-offset-4">← {c.allGroups}</Link>
          <h2 className="mt-3 text-3xl">{group}</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <li key={item.id} id={`i-${item.id}`} data-item={item.name} className="card min-w-0 scroll-mt-24 space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <ItemPicture itemId={item.id} category={item.category} photoVersion={item.photoVersion} />
                  <div className="min-w-0">
                    <p className="font-bold [overflow-wrap:anywhere]">{item.name}</p>
                    <p data-testid="item-count" className={item.count === null ? 'text-sm text-ink/70' : 'font-display text-3xl'}>
                      {item.count === null ? c.notCounted : item.count}
                    </p>
                  </div>
                </div>
                <form action={countAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="group" value={group} />
                  <div className="w-24">
                    <label className="label" htmlFor={`n-${item.id}`}>{c.amount}</label>
                    <input id={`n-${item.id}`} name="amount" className="field" inputMode="numeric" pattern="[0-9]*" maxLength={5} required />
                  </div>
                  <button type="submit" name="what" value="set" className="btn-small">{c.set}</button>
                  <button type="submit" name="what" value="put" className="btn-small">{c.put}</button>
                  <button type="submit" name="what" value="take" className="btn-small">{c.take}</button>
                </form>
                <div className="flex flex-wrap items-center gap-2">
                  <PhotoPicker itemId={item.id} has={item.hasPhoto} />
                  <form action={haveAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="group" value={group} />
                    <input type="hidden" name="have" value="0" />
                    <button type="submit" className="btn-small">{c.dontHave}</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <form action={addItemAction} className="card mt-8 max-w-xl space-y-4 p-5">
            <h3 className="text-2xl">{c.addTitle}</h3>
            <input type="hidden" name="category" value={group} />
            <input type="hidden" name="group" value={group} />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <div>
                <label className="label" htmlFor="itemName">{c.name}</label>
                <input id="itemName" name="name" className="field" maxLength={80} required />
              </div>
              <div>
                <label className="label" htmlFor="itemCount">{c.startCount}</label>
                <input id="itemCount" name="count" className="field" inputMode="numeric" pattern="[0-9]*" maxLength={5} />
              </div>
            </div>
            <button type="submit" className="btn-pill bg-arcade-purple text-paper !shadow-none">{c.add}</button>
          </form>

          {aside.length > 0 && (
            <details data-testid="inventory-aside" className="mt-10 rounded-xl border-2 border-paper/20 bg-deep p-4">
              <summary className="cursor-pointer text-xl font-bold">{c.asideTitle(aside.length)}</summary>
              <p className="mt-2 text-sm text-paper/70">{c.asideHelp}</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {aside.map((item) => (
                  <li key={item.id} data-aside-item={item.name} className="flex items-center justify-between gap-3 rounded-lg border-2 border-paper/20 px-3 py-2">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{item.name}</span>
                    <form action={haveAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="group" value={group} />
                      <input type="hidden" name="have" value="1" />
                      <button type="submit" className="btn-small">{c.doHave}</button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
