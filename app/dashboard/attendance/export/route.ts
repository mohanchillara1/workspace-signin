import { attendanceRows } from '@/lib/attendance';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { chicagoTime, isDay } from '@/lib/day';
import { toCsv } from '@/lib/csv';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// The attendance CSV. Full names are in it, so it needs a lead's login.
export async function GET(request: Request) {
  await requireLead();
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!isDay(from) || !isDay(to) || from > to) return new Response(copy.errors.exportDays, { status: 400 });
  const a = copy.attendance;
  const rows = await attendanceRows(getDb(), { from, to });
  const csv = toCsv(
    [...a.csvHeaders],
    rows.map((r) => [
      r.day,
      r.firstName,
      r.lastName,
      r.subteam,
      r.firstScanAt ? chicagoTime(r.firstScanAt) : '',
      r.source === 'kiosk' ? a.csvKiosk : r.source === 'sheet' ? a.csvSheet : a.csvManual,
      r.recordedBy,
    ]),
  );
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="attendance-${from}-to-${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
