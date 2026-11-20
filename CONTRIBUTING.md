# Contributing

## Get it running

Follow "Run it" and "Check it" in `README.md`. So far the app has only been run on Linux (Ubuntu under WSL2). If a step is wrong or missing on your machine, that is a bug in the notes: fix the README in your pull request, or open an issue.

Before you open a pull request, run both:

```bash
npm test             # the rules, against a throwaway Postgres
npm run test:e2e     # builds the app, then drives it in Chrome
```

## How changes get in

- Work on a branch, not on `main`, and open a pull request.
- Write the test first and see it fail, then write the code. A fix comes with a test that fails without it.
- Keep a pull request to one thing.
- Every fixed string on a screen goes in `lib/copy.ts` (or a file under `lib/copy/`). Run `npm run copy:md` after changing one.

## Commits and pull requests

- Commit under your own name and email.
- No AI co-author lines and no "generated with" lines, in commit messages or in pull request descriptions.

If you use Claude Code, it adds both by default. To turn them off, put this in `~/.claude/settings.json` (every project) or in `.claude/settings.local.json` in this folder (this project only; git ignores it here):

```json
{
  "attribution": {
    "commit": "",
    "pr": "",
    "sessionUrl": false
  }
}
```

This comes from Claude Code's settings reference, under "Git and attribution": https://code.claude.com/docs/en/settings-reference.md#attribution. Look at your commit with `git log -1` before you push.

## Names and secrets

- No real member's name anywhere: code, tests, seeds, issues, pull requests, screenshots. Use made-up names ("Test Member A").
- No keys, passwords or database addresses in the repo. Settings go in `.env.local`, which git ignores.

## The hosted test copy

A test copy with made-up names runs on a host. It is deployed by hand and is not connected to this repository. Nothing you push changes it.
