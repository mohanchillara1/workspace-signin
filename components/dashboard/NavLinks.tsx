'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { logOut } from '@/app/login/actions';
import { copy } from '@/lib/copy';

const LINKS = [
  { href: '/dashboard', label: copy.nav.today },
  { href: '/dashboard/tasks', label: copy.nav.tasks },
  { href: '/dashboard/review', label: copy.review.navLabel },
  { href: '/dashboard/finished', label: copy.nav.finished },
  { href: '/dashboard/members', label: copy.nav.members },
  { href: '/dashboard/attendance', label: copy.nav.attendance },
  { href: '/dashboard/kiosk', label: copy.nav.kiosk },
];

/**
 * The dashboard's top bar. On a wide screen the links sit in a row, as on the
 * team site. On a phone they fold behind one yellow Menu pill, also as on the
 * team site, so the bar stays one row tall.
 */
export function DashboardNav({ leadName }: { leadName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const isActive = (href: string) => (href === '/dashboard' ? pathname === href : pathname.startsWith(href));
  const account = (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-paper/70">{copy.nav.loggedInAs(leadName)}</p>
      <form action={logOut}>
        <button type="submit" className="btn-small">{copy.nav.logout}</button>
      </form>
    </div>
  );

  return (
    <header className="border-b-2 border-paper/20 bg-space">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center">
          <Image src="/wordmark.png" alt={copy.app.title} width={380} height={115} priority className="h-9 w-auto" />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={`rounded-full px-3 py-2 text-[15px] font-semibold transition-colors ${isActive(link.href) ? 'bg-paper text-ink' : 'hover:bg-paper/10'}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden lg:block">{account}</div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls="dashboard-menu"
          onClick={() => setOpen((value) => !value)}
          className="btn-pill h-11 bg-arcade-fuel px-5 text-sm font-bold uppercase tracking-wide text-ink !shadow-none lg:hidden"
        >
          {open ? copy.nav.closeMenu : copy.nav.menu}
        </button>
      </div>

      {open && (
        <div id="dashboard-menu" className="border-t-2 border-paper/20 px-4 pb-5 pt-3 lg:hidden">
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? 'page' : undefined}
                className={`rounded-full px-4 py-3 text-lg font-semibold ${isActive(link.href) ? 'bg-paper text-ink' : 'hover:bg-paper/10'}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 px-4">{account}</div>
        </div>
      )}
    </header>
  );
}
