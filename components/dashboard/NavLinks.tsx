'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { copy } from '@/lib/copy';

const LINKS = [
  { href: '/dashboard', label: copy.nav.today },
  { href: '/dashboard/tasks', label: copy.nav.tasks },
  { href: '/dashboard/finished', label: copy.nav.finished },
  { href: '/dashboard/members', label: copy.nav.members },
  { href: '/dashboard/attendance', label: copy.nav.attendance },
  { href: '/dashboard/kiosk', label: copy.nav.kiosk },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        const active = link.href === '/dashboard' ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full px-3 py-2 text-[15px] font-semibold transition-colors ${active ? 'bg-paper text-ink' : 'hover:bg-paper/10'}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
