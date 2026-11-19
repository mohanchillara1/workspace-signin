import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DashboardNav } from '@/components/dashboard/NavLinks';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.app.title };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const lead = await requireLead();
  return (
    <div className="min-h-dvh">
      <DashboardNav leadName={`${lead.firstName} ${lead.lastName}`.trim()} />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">{children}</main>
    </div>
  );
}
