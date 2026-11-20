# Checking tasks off from Slack

Members type `/done` in the team's Slack to see their open tasks, or `/done 2` to finish number 2. Only they see the answer. A task that needs a lead's check goes to the review queue, as it does from a member's page.

No Slack app exists yet. A person who can add apps to the team's Slack (a workspace admin, or an owner) has to make one. Nothing here sends anything to Slack: the app only answers when Slack calls it.

## Install it

1. Decide the site's public address. It must be `https`.
2. Open `manifest.yaml` in this folder and replace `YOUR-SITE-ADDRESS` with that address.
3. In Slack, go to https://api.slack.com/apps, choose **Create New App**, then **From a manifest**, pick the workspace, and paste the file in.
4. Choose **Install to Workspace**.
5. In the app's settings, open **Basic Information**, find **Signing Secret**, and copy it.
6. Put it in the site's settings as `SLACK_SIGNING_SECRET` and redeploy. Leave it unset and the Slack address refuses every request.
7. On the Members screen, open **Edit** for each member who will use Slack and paste their **Slack member ID**. To find it: in Slack, open their profile and look for the option to copy their member ID. It starts with U or W. (This step was not checked against a page; Slack's menu may differ.)
8. In Slack, type `/done`.

## What it asks Slack for

One bot scope, `commands`, which Slack's reference says "enables shortcuts and slash commands for a workspace" (https://docs.slack.dev/reference/scopes/commands). The app reads no messages and posts nothing by itself. The manifest includes a bot user because the `commands` scope is a bot scope; Slack's pages do not say whether a manifest without one is accepted.

## How a request is checked

Every request must carry Slack's signature (`X-Slack-Signature`) and timestamp (`X-Slack-Request-Timestamp`). The app computes the signature from the signing secret as Slack's page "Verifying requests from Slack" describes, and refuses anything that does not match or is more than five minutes old, before it reads anything else. Each Slack user may use `/done` 20 times a minute.

## Not checked yet

Everything above was built to Slack's pages and tested with requests the tests sign themselves. It has not been run against a real Slack app.
