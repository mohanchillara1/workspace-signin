import type { Metadata } from 'next';
import Image from 'next/image';
import { MemberLoginForm } from '@/components/dashboard/MemberLoginForm';
import { copy } from '@/lib/copy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.login.title };

// The main login: members open their own page by name. Leads and captains
// log in at /admin, which this page does not mention: they are told the
// address. Nobody is sent away from here for being logged in, so a lead can
// still open their own member page.
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Image src="/wordmark.png" alt={copy.app.title} width={380} height={115} priority className="mb-4 h-10 w-auto self-start" />
      <h1 className="mb-6 mt-1 text-5xl">{copy.login.title}</h1>
      <MemberLoginForm />
    </main>
  );
}
