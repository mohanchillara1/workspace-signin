import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/dashboard/LoginForm';
import { currentLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.login.title };

export default async function LoginPage() {
  if (await currentLead()) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="font-display text-xl text-arcade-fuel">{copy.app.title}</p>
      <h1 className="mb-6 mt-1 text-5xl">{copy.login.title}</h1>
      <LoginForm />
    </main>
  );
}
