import { copy } from '@/lib/copy';
import { chicagoDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { answerSlackCommand, slackAvailable, verifySlackRequest } from '@/lib/slack';

export const dynamic = 'force-dynamic';

// Slack's /done command. https://docs.slack.dev/interactivity/implementing-slash-commands
// Slack sends a form-encoded POST and waits 3 seconds for the answer, so
// the answer is made here and not sent later to response_url.
const BODY_MAX = 20_000;
const headers = { 'cache-control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  if (!slackAvailable()) return new Response(null, { status: 404, headers });

  // The signature comes first: nothing from the body or the database is
  // looked at before it passes, and a failure says nothing else.
  const length = Number(request.headers.get('content-length') ?? 0);
  const refuse = () => new Response(null, { status: 401, headers });
  if (length > BODY_MAX) return refuse();
  const rawBody = await request.text();
  const now = new Date();
  const genuine =
    rawBody.length <= BODY_MAX &&
    verifySlackRequest({
      signingSecret: (process.env.SLACK_SIGNING_SECRET ?? '').trim(),
      timestamp: request.headers.get('x-slack-request-timestamp'),
      signature: request.headers.get('x-slack-signature'),
      rawBody,
      now,
    });
  if (!genuine) return refuse();

  const form = new URLSearchParams(rawBody);
  // Slack may check the address now and then with ssl_check=1 and wants a plain 200.
  if (form.get('ssl_check') === '1') return new Response(null, { status: 200, headers });

  let text: string;
  try {
    ({ text } = await answerSlackCommand(getDb(), {
      slackUserId: form.get('user_id') ?? '',
      text: form.get('text') ?? '',
      today: chicagoDay(now),
      now,
    }));
  } catch (error) {
    console.error('A Slack command could not be answered.', error);
    text = copy.slack.failed;
  }
  return Response.json({ response_type: 'ephemeral', text }, { status: 200, headers });
}
