import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { logOut } from '@/app/login/actions';
import { NavLinks } from '@/components/dashboard/NavLinks';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { shortName } from '@/lib/names';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.app.title };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const lead = await requireLead();
  return (
    <div className="min-h-dvh">
      <header className="border-b-2 border-paper/20 bg-space">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="font-display text-xl leading-none text-arcade-fuel">
            {copy.app.title}
          </Link>
          <NavLinks />
          <div className="flex items-center gap-3">
            <p className="text-sm text-paper/70">{copy.nav.loggedInAs(shortName(lead.firstName, lead.lastName))}</p>
            <form action={logOut}>
              <button type="submit" className="btn-small">{copy.nav.logout}</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">{children}</main>
    </div>
  );
}
