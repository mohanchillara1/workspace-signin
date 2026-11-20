import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/dashboard/LoginForm';
import { currentLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';

export const dynamic = 'force-dynamic';
// The title is the app's short name, not "Log in": a browser that takes a
// Home Screen or shortcut name from the title then offers "Singularity".
export const metadata: Metadata = { title: copy.app.shortTitle };

// Where leads and captains log in. Members have their own page, /login.
export default async function AdminLoginPage() {
  if (await currentLead()) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Image src="/wordmark.png" alt={copy.app.title} width={380} height={115} priority className="mb-4 h-10 w-auto self-start" />
      <h1 className="mb-6 mt-1 text-5xl">{copy.login.title}</h1>
      <LoginForm />
      <p className="mt-6 text-sm text-paper/70">
        <Link href="/login" className="underline underline-offset-4">{copy.login.toMembers}</Link>
      </p>
    </main>
  );
}
