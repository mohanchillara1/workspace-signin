// Made-up people and tasks for local use and for tests. No real name belongs
// in this file.
import { acceptInvite, createInvite } from './auth/leads';
import type { Db } from './db/client';
import type { Member } from './db/schema';
import { addMember, addSubteam } from './members';
import { createTask, publishTask } from './tasks';

export type SeedInfo = {
  captain: { loginName: string; password: string; member: Member };
  lead: Member;
  subteams: Record<string, string>;
  members: Record<string, Member>;
};

/** The least a working system needs: subteams, a captain who can log in, a lead. */
export async function seedBase(db: Db, options: { captainPassword: string }): Promise<SeedInfo> {
  const now = new Date();
  const subteams: Record<string, string> = {};
  for (const name of ['Build', 'Programming', 'Business']) subteams[name] = (await addSubteam(db, name)).id;
  const captain = await addMember(
    db,
    { firstName: 'Test', lastName: 'Captain', role: 'captain', subteamId: subteams.Business },
    null,
  );
  const token = await createInvite(db, { memberId: captain.id, actorId: null, now, bootstrap: true });
  const accepted = await acceptInvite(db, {
    token,
    loginName: 'testcaptain',
    password: options.captainPassword,
    now,
  });
  if (!accepted.ok) throw new Error(`The seed captain could not be given a login: ${accepted.reason}`);
  const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead', subteamId: subteams.Build }, captain.id);
  return {
    captain: { loginName: 'testcaptain', password: options.captainPassword, member: captain },
    lead,
    subteams,
    members: {},
  };
}

/** A fuller set for looking at the screens: twelve people and tasks of every kind. */
export async function seedDemo(db: Db, options: { captainPassword: string; today: string }): Promise<SeedInfo> {
  const info = await seedBase(db, options);
  const actor = info.captain.member.id;
  const { Build, Programming, Business } = info.subteams;
  const people: [string, string | null][] = [
    ['A', Build],
    ['B', Build],
    ['C', Build],
    ['D', Programming],
    ['E', Programming],
    ['F', Programming],
    ['G', Business],
    ['H', Business],
    ['I', null],
    ['J', null],
  ];
  for (const [letter, subteamId] of people) {
    info.members[letter] = await addMember(db, { firstName: 'Test', lastName: `Member ${letter}`, subteamId }, actor);
  }
  const m = info.members;
  const plusDays = (n: number) => {
    const date = new Date(`${options.today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  };
  const tasks: Parameters<typeof createTask>[1][] = [
    {
      title: 'Sort the bolt bins by size',
      description: 'The bins are on the shelf by the door. Mixed sizes go in the tray on top.',
      steps: ['Empty one bin onto the mat', 'Sort by length', 'Put each size back in its labeled bin', 'Repeat for the next bin'],
      audience: 'person',
      memberIds: [m.A.id],
      dueDay: plusDays(2),
    },
    {
      title: 'Read the shop safety sheet and sign it',
      steps: ['Read both sides', 'Sign the bottom', 'Hand it to a lead'],
      audience: 'person',
      memberIds: [m.A.id, m.B.id, m.D.id, m.G.id],
      completion: 'each',
      dueDay: plusDays(-1),
    },
    {
      title: 'Square up the practice frame',
      description: 'Check every corner with the big square before anything is bolted down.',
      steps: ['Loosen the corner bolts', 'Check each corner with the square', 'Tighten in a cross pattern', 'Measure both diagonals'],
      audience: 'subteam',
      subteamId: Build,
      dueDay: plusDays(4),
    },
    {
      title: 'Get the test board blinking',
      steps: ['Plug the board into the laptop', 'Load the blink example', 'Change the delay and load it again'],
      audience: 'subteam',
      subteamId: Programming,
      completion: 'each',
    },
    {
      title: 'Draft the thank-you note for the parts donation',
      audience: 'subteam',
      subteamId: Business,
      dueDay: plusDays(6),
    },
    {
      title: 'Label the new battery chargers',
      description: 'Labels and the marker are in the top drawer.',
      steps: ['Number each charger', 'Write the number on the cable too'],
      audience: 'pool',
    },
    { title: 'Count the safety glasses and note how many are scratched', audience: 'pool' },
    { title: 'Sweep under the bench', audience: 'pool', standing: true },
    { title: 'Wipe down the work tables', audience: 'pool', standing: true },
  ];
  for (const input of tasks) {
    const task = await createTask(db, input, actor);
    await publishTask(db, task.id, actor);
  }
  await createTask(db, { title: 'Plan the tool wall layout', audience: 'pool' }, actor);
  return info;
}
