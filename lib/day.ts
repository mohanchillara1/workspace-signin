// A "day" in this app is the calendar date in Central time, worked out on the
// server. The device's own clock and time zone never decide it.
const ZONE = 'America/Chicago';

const dayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clock = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });

const longDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** The Central calendar date of a moment, as YYYY-MM-DD. */
export function chicagoDay(at: Date): string {
  const parts = Object.fromEntries(dayParts.formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A day n days after (or before) the given YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** The Central clock time of a moment, like "4:32 PM". */
export function chicagoTime(at: Date): string {
  return clock.format(at);
}

/** A YYYY-MM-DD day written out, like "Wed, Nov 18". */
export function dayLabel(day: string): string {
  return longDay.format(new Date(`${day}T12:00:00Z`));
}

export function isDay(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T12:00:00Z`));
}
