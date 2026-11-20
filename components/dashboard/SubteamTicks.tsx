import { copy } from '@/lib/copy';

type Row = { id: string; name: string; parentId: string | null };

/**
 * A tick box for each subteam, any number of them. A subteam that is part of
 * another sits under it, set in.
 */
export function SubteamTicks({ subteams, chosen }: { subteams: Row[]; chosen: string[] }) {
  if (subteams.length === 0) return <p className="text-sm opacity-70">{copy.members.subteamsEmpty}</p>;
  const tick = (s: Row) => (
    <label className="flex items-center gap-3">
      <input type="checkbox" name="subteamIds" value={s.id} defaultChecked={chosen.includes(s.id)} className="h-5 w-5 shrink-0 accent-arcade-purple" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{s.name}</span>
    </label>
  );
  return (
    <div className="gap-x-6 sm:columns-2">
      {subteams
        .filter((s) => !s.parentId)
        .map((top) => (
          <div key={top.id} className="mb-2 break-inside-avoid space-y-2">
            {tick(top)}
            {subteams
              .filter((s) => s.parentId === top.id)
              .map((s) => (
                <div key={s.id} className="pl-8">{tick(s)}</div>
              ))}
          </div>
        ))}
    </div>
  );
}
