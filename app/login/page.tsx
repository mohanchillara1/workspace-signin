import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { MemberLoginForm } from '@/components/dashboard/MemberLoginForm';
import { rememberedMemberKey } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { memberByPageKey } from '@/lib/members';
import { copy } from '@/lib/copy';

export const dynamic = 'force-dynamic';
// The title is the app's short name, not "Log in": a browser that takes a
// Home Screen or shortcut name from the title then offers "Singularity".
export const metadata: Metadata = { title: copy.app.shortTitle };

// The main login: members open their own page by name. Leads and captains
// log in at /admin, which this page does not mention: they are told the
// address. Nobody is sent away from here for being logged in, so a lead can
// still open their own member page. A member who chose "Keep me signed in"
// goes straight to their page.
export default async function LoginPage() {
  const saved = await rememberedMemberKey();
  if (saved && (await memberByPageKey(getDb(), saved))) redirect(`/m/${saved}`);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Image src="/wordmark.png" alt={copy.app.title} width={380} height={115} priority className="mb-4 h-10 w-auto self-start" />
      <h1 className="mb-6 mt-1 text-5xl">{copy.login.title}</h1>
      <MemberLoginForm />
    </main>
  );
}
