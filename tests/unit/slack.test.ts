import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SLACK_ID_PATTERN, slackAvailable, verifySlackRequest } from '@/lib/slack';

// The worked example on https://docs.slack.dev/authentication/verifying-requests-from-slack
const DOC_SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const DOC_TIMESTAMP = '1531420618';
const DOC_BODY =
  'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
const DOC_SIGNATURE = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';
const at = (seconds: number) => new Date(seconds * 1000);
const NOW = at(Number(DOC_TIMESTAMP));

const check = (over: Partial<Parameters<typeof verifySlackRequest>[0]> = {}) =>
  verifySlackRequest({
    signingSecret: DOC_SECRET,
    timestamp: DOC_TIMESTAMP,
    signature: DOC_SIGNATURE,
    rawBody: DOC_BODY,
    now: NOW,
    ...over,
  });

describe('verifying a request from Slack', () => {
  it("accepts the docs' own worked example, exactly", () => {
    expect(check()).toBe(true);
  });

  it('accepts a request made with the same steps and a different secret', () => {
    const timestamp = '1800000000';
    const body = 'command=%2Fdone&text=2&user_id=U123ABC456';
    const signature = 'v0=' + createHmac('sha256', 'another-secret').update(`v0:${timestamp}:${body}`).digest('hex');
    expect(check({ signingSecret: 'another-secret', timestamp, signature, rawBody: body, now: at(1800000100) })).toBe(true);
  });

  it('refuses a missing or empty signature or timestamp', () => {
    expect(check({ signature: null })).toBe(false);
    expect(check({ signature: '' })).toBe(false);
    expect(check({ timestamp: null })).toBe(false);
    expect(check({ timestamp: '' })).toBe(false);
  });

  it('refuses a wrong signature, a wrong secret, an empty secret and a signature of another length', () => {
    expect(check({ signature: DOC_SIGNATURE.replace(/.$/, '0') })).toBe(false);
    expect(check({ signingSecret: 'not-the-secret' })).toBe(false);
    expect(check({ signingSecret: '' })).toBe(false);
    expect(check({ signature: 'v0=abcd' })).toBe(false);
    expect(check({ signature: DOC_SIGNATURE + '00' })).toBe(false);
    expect(check({ signature: DOC_SIGNATURE.slice(3) })).toBe(false);
  });

  it('refuses a body that was changed by one character, and a changed timestamp', () => {
    expect(check({ rawBody: DOC_BODY.replace('text=', 'text=1') })).toBe(false);
    expect(check({ rawBody: DOC_BODY + '&' })).toBe(false);
    expect(check({ timestamp: '1531420619' })).toBe(false);
  });

  it('refuses a request more than five minutes from now, in either direction, and takes exactly five', () => {
    expect(check({ now: at(1531420618 + 300) })).toBe(true);
    expect(check({ now: at(1531420618 - 300) })).toBe(true);
    expect(check({ now: at(1531420618 + 301) })).toBe(false);
    expect(check({ now: at(1531420618 - 301) })).toBe(false);
  });

  it('refuses a timestamp that is not plain digits, even with a matching signature', () => {
    for (const timestamp of ['1531420618.5', ' 1531420618', '0x5b4a', '1e9', '-1531420618']) {
      const signature = 'v0=' + createHmac('sha256', DOC_SECRET).update(`v0:${timestamp}:${DOC_BODY}`).digest('hex');
      expect(check({ timestamp, signature })).toBe(false);
    }
  });
});

describe('the Slack member id shape', () => {
  it('takes ids like the docs show and nothing else', () => {
    for (const ok of ['U123ABC456', 'W012A3CDE', 'U012ABCDEF']) expect(SLACK_ID_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', 'u123abc456', 'U12', 'T1DC2JH3J', 'U123 ABC456', 'U123ABC456\n', '@someone', '<@U123ABC456>', 'U'.repeat(40)])
      expect(SLACK_ID_PATTERN.test(bad)).toBe(false);
  });
});

describe('slackAvailable', () => {
  it('is true only when a signing secret is set', () => {
    const before = process.env.SLACK_SIGNING_SECRET;
    try {
      delete process.env.SLACK_SIGNING_SECRET;
      expect(slackAvailable()).toBe(false);
      process.env.SLACK_SIGNING_SECRET = '   ';
      expect(slackAvailable()).toBe(false);
      process.env.SLACK_SIGNING_SECRET = 'x';
      expect(slackAvailable()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.SLACK_SIGNING_SECRET;
      else process.env.SLACK_SIGNING_SECRET = before;
    }
  });
});

describe('the Slack address with no signing secret', () => {
  it('answers 404 and reads nothing, even for a request that is validly signed', async () => {
    const before = process.env.SLACK_SIGNING_SECRET;
    try {
      delete process.env.SLACK_SIGNING_SECRET;
      const { POST } = await import('@/app/api/slack/command/route');
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = 'command=%2Fdone&user_id=U123ABC456&text=';
      const signature = 'v0=' + createHmac('sha256', '').update(`v0:${timestamp}:${body}`).digest('hex');
      const response = await POST(
        new Request('http://localhost/api/slack/command', {
          method: 'POST',
          headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature, 'content-type': 'application/x-www-form-urlencoded' },
          body,
        }),
      );
      expect(response.status).toBe(404);
    } finally {
      if (before !== undefined) process.env.SLACK_SIGNING_SECRET = before;
    }
  });
});
