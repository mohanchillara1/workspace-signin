import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { listMembers } from '@/lib/members';
import { shortName } from '@/lib/names';
import { qrSvg } from '@/lib/qr';

export const dynamic = 'force-dynamic';

// A sheet of QR codes for people without a phone that day.
export default async function PrintPage() {
  await requireLead();
  const members = (await listMembers(getDb())).filter((m) => m.active);
  const cards = await Promise.all(
    members.map(async (m) => ({ id: m.id, name: shortName(m.firstName, m.lastName), svg: await qrSvg(m.scanCode) })),
  );
  return (
    <>
      <div className="print:hidden">
        <h1 className="text-5xl">{copy.members.printTitle}</h1>
        <p className="mt-2 text-paper/70">{copy.members.printHelp}</p>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-0 bg-white text-ink sm:grid-cols-3 lg:grid-cols-4 print:mt-0 print:grid-cols-3">
        {cards.map((card) => (
          <div key={card.id} data-testid="print-card" className="break-inside-avoid border border-dashed border-ink/40 p-4 text-center">
            <div className="[&>svg]:mx-auto [&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-[11rem]" dangerouslySetInnerHTML={{ __html: card.svg }} />
            <p className="mt-1 text-lg font-bold">{card.name}</p>
          </div>
        ))}
      </div>
    </>
  );
}
