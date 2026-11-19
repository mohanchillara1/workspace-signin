import type { Metadata } from 'next';
import Image from 'next/image';
import { InviteForm } from '@/components/dashboard/InviteForm';
import { inviteMember } from '@/lib/auth/leads';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.app.title };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const member = await inviteMember(getDb(), token, new Date());
  const c = copy.invite;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Image src="/wordmark.png" alt={copy.app.title} width={380} height={115} priority className="mb-4 h-10 w-auto self-start" />
      {member ? (
        <>
          <h1 className="mt-1 text-4xl">{c.title(member.firstName)}</h1>
          <p className="mb-6 mt-3 text-lg text-paper/85">{c.body}</p>
          <InviteForm token={token} />
        </>
      ) : (
        <>
          <h1 className="mt-1 text-4xl">{c.badLinkTitle}</h1>
          <p className="mt-3 text-lg text-paper/85">{c.badLinkBody}</p>
        </>
      )}
    </main>
  );
}
