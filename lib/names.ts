/** What screens show for a person: the first name and the last initial. */
export function shortName(first: string, last: string): string {
  const firstName = first.trim();
  const initial = [...last.trim()][0];
  return initial ? `${firstName} ${initial.toLocaleUpperCase()}.` : firstName;
}
