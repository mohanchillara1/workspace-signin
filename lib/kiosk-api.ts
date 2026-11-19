// Shared by the kiosk's route handlers: who is asking, and how to answer.
import { currentKiosk, sameOrigin } from './auth/session';
import type { Kiosk } from './db/schema';

export const NOT_PAIRED = { status: 'not_paired' } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** The paired kiosk making this request, or a 401/403 response to send back. */
export async function kioskOr401(request: Request): Promise<Kiosk | Response> {
  if (!(await sameOrigin(request))) return json({ status: 'forbidden' }, 403);
  const kiosk = await currentKiosk();
  return kiosk ?? json(NOT_PAIRED, 401);
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
