'use server';

import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { isUuid } from '@/lib/ids';
import { listSubteams } from '@/lib/members';
import { hit } from '@/lib/rate-limit';
import { DraftError, draftsAvailable, draftSteps } from '@/lib/step-drafts';

export type DraftResult = { steps: string[]; problem?: undefined } | { problem: string; steps?: undefined };

const DRAFTS_A_MINUTE = 10;

/**
 * Drafts steps for the task form. Saves nothing: the lead reads the steps,
 * fixes them, and saves or publishes the form as usual.
 */
export async function draftStepsAction(input: { title: string; description: string; subteamId: string }): Promise<DraftResult> {
  const lead = await requireLead();
  // A server action can be called with anything. Only strings are used.
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const description = typeof input?.description === 'string' ? input.description : '';
  const subteamId = typeof input?.subteamId === 'string' ? input.subteamId : '';
  if (!title) return { problem: copy.drafts.needTitle };
  if (!draftsAvailable()) return { problem: copy.drafts.unavailable };

  try {
    const db = getDb();
    const { allowed } = await hit(db, { key: `drafts:${lead.id}`, limit: DRAFTS_A_MINUTE, windowSeconds: 60, now: new Date() });
    if (!allowed) return { problem: copy.drafts.tooMany };

    let subteam: string | null = null;
    if (isUuid(subteamId)) subteam = (await listSubteams(db)).find((s) => s.id === subteamId)?.name ?? null;

    return { steps: await draftSteps({ title, description, subteam }) };
  } catch (error) {
    return { problem: error instanceof DraftError ? error.message : copy.drafts.failed };
  }
}
