---
name: listen-notifications
description: Send an explicitly requested notification to a configured Listen source webhook.
argument-hint: '[notification purpose or message]'
---

# Listen notifications

Listen is a single-user web/Docker notification inbox. There is no Listen client
CLI or installer. A source webhook URL, created by the owner in Sources, is the
credential for delivery.

Send a notification **only when the user explicitly requests one**. A configured
webhook, completed task, failure or need for input is not authorization to send.
Do not use a real webhook during development or tests.

Use the caller's existing secure HTTP integration. Send one JSON `POST` with
`Content-Type: application/json` and:

```json
{
  "title": "Review needed",
  "shortDescription": "The changes are ready for review.",
  "markdownContent": "Build and tests passed. Review the proposed changes."
}
```

`icon` may be a PNG data URL. The saved source determines the source name;
caller-supplied identity/source fields cannot select an owner.

Read the URL from a private file or existing secret integration. Never request
credentials in chat, print/log the URL, include it in reports, or commit it.
Do not include credentials, cookies, private logs or other secrets in content.
Webhook URLs appear only at source creation/rotation; rotation retires the old
token and deleting a source removes its notifications.

HTTP `201` means the webhook was accepted, not that a human saw it or a push
notification arrived. Report delivery failures to the user. Never automatically
retry an uncertain send.
