---
name: listen-notifications
description: 'Send push notifications from coding agents using the listen CLI. Use when: notifying a human that work completed, failed, needs review, needs input, or long-running automation needs attention. Assumes listen is installed, available on PATH, and already configured.'
argument-hint: '[notification purpose or message]'
---

# Listen Notifications

Use this skill to send a push notification to a human through the `listen` CLI. Assume `listen` is already installed, available on `PATH`, and configured with a webhook URL.

## When to Use

- A task completes successfully and the user should know.
- Work fails or is blocked and the user needs to take action.
- Review, approval, credentials, or other human input is needed.
- A long-running command, deploy, build, test run, or automation reaches an important state.
- You need to notify the user without interrupting the current chat flow.

## Procedure

1. Decide whether a notification is useful and timely. Do not send noisy progress updates for every small step.
2. Write a short, specific title that fits in a system notification.
3. Write a one-sentence description that explains the immediate state.
4. Put useful details in Markdown. Include the result, blocker, next action, and relevant paths or commands when helpful.
5. Send the notification with `listen notify`.
6. Check the command result. If it fails, report the failure in chat instead of retrying repeatedly.

## Command Patterns

Send a simple notification:

```bash
listen notify --title "Task completed" --description "The requested work finished successfully." --markdown "Done. Build and tests passed."
```

Send a review or input request:

```bash
listen notify --title "Review needed" --description "The changes are ready for your review." --markdown "Please review the updated implementation and let me know whether to proceed."
```

Send Markdown from standard input when the message is easier to compose as multiple lines:

```bash
printf '%s\n' "Build failed." "" "Next action: inspect the failing test output in chat." | listen notify --title "Build failed" --description "The verification command did not pass." --markdown-file -
```

Send Markdown from a file when a command or workflow already produced a report:

```bash
listen notify --title "Report ready" --description "The generated report is available." --markdown-file ./report.md
```

Attach an optional PNG icon:

```bash
listen notify --title "Deploy finished" --description "Production deployment completed." --markdown "Deployment completed successfully." --icon-file ./icon.png
```

## Message Guidance

- Keep titles concise: `Build failed`, `Review needed`, `Deploy finished`, `Input needed`.
- Make descriptions scannable and action-oriented.
- Use Markdown for details, not for secrets.
- Do not include passwords, API keys, tokens, cookies, passkey material, auth headers, or raw credentials.
- Do not paste huge logs. Summarize the important lines and point to where full output can be found.
- Prefer one notification at the end of a meaningful state transition over repeated notifications during normal progress.

## Failure Handling

If `listen notify` exits non-zero, read the error and surface it to the user in chat. Common issues include missing CLI configuration, unreachable Listen server, invalid Markdown input, or a non-PNG `--icon-file`.
