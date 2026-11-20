// A person drawn as head and shoulders in their group's colour, initials on the chest.
// Leads and captains get a yellow ring.

const PALETTE = ['#7FB7FF', '#B48CFF', '#FF8A5C', '#FF5A6E', '#5FE0B5', '#E7C9FF', '#FF9BD2', '#9BE15D', '#F2B84B', '#6EE7F0'];
export const NO_GROUP_COLOUR = '#6f6b7a';

/**
 * A subteam's colour: its place among all subteam names, in alphabetical order,
 * so up to ten subteams each get their own and every screen agrees.
 */
export function groupColour(name: string | null, allNames: string[]): string {
  if (!name) return NO_GROUP_COLOUR;
  const sorted = [...allNames].sort((a, b) => a.localeCompare(b));
  const at = sorted.indexOf(name);
  return PALETTE[(at === -1 ? 0 : at) % PALETTE.length];
}

export function PersonFigure({
  firstName,
  lastName,
  colour,
  ringed,
  size = 56,
}: {
  firstName: string;
  lastName: string;
  colour: string;
  ringed: boolean;
  size?: number;
}) {
  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="shrink-0">
      <circle cx="32" cy="32" r="30" fill="#1b1a24" stroke={ringed ? '#FFD23F' : 'none'} strokeWidth="3" />
      <circle cx="32" cy="24" r="10" fill={colour} />
      <path d="M12 54c2-12 10-18 20-18s18 6 20 18a30 30 0 0 1-40 0z" fill={colour} />
      <text x="32" y="51" textAnchor="middle" fontSize="10" fontWeight="800" fill="#050507">
        {initials}
      </text>
    </svg>
  );
}
