import type { SourceMutationResponse } from "@listen/contracts";

interface DemoNotification {
  title: string;
  shortDescription: string;
  markdownContent: string;
  icon?: string;
}

const DEFAULT_SOURCE_NAMES = [
  "Copilot Coding Agent",
  "CI Pipeline",
  "Code Review Bot",
  "Release Automation",
];

const DEMO_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax0Qn8AAAAASUVORK5CYII=";

function envString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envBoolean(name: string): boolean {
  const value = process.env[name]?.toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

async function apiJson<T>(url: string, init?: RequestInit, context = "API request"): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.clone().json() as { message?: string };
      message = body.message ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(`${message} (${context})`);
  }
  return response.json() as Promise<T>;
}

function buildSourceNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => DEFAULT_SOURCE_NAMES[index] ?? `Demo Source ${index + 1}`);
}

function demoNotifications(count: number): DemoNotification[] {
  const templates: DemoNotification[] = [
    {
      title: "Mobile overflow validation: this very long notification title must truncate in the sticky header",
      shortDescription: "This demo notification intentionally includes a long summary, several paragraphs, tables, long links, inline code tokens, and enough content to validate mobile wrapping and action button visibility.",
      markdownContent: [
        "# Mobile overflow validation notification with a long markdown heading that must wrap safely inside the notification detail panel",
        "",
        "This notification exists to validate mobile detail rendering with realistic long-form content. The text is intentionally verbose so it can reveal cases where a paragraph calculates a larger intrinsic width than the viewport and pushes the Delete button off screen.",
        "",
        "A second paragraph repeats the same pressure with different words: the detail view should keep every sentence inside the visible panel, even when the browser is using a narrow phone-sized viewport and the sidebar reveal button changes the header padding.",
        "",
        "A long unbroken token should not define the page width: mobile-overflow-validation-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.",
        "",
        "## Criteria",
        "",
        "- The sticky header title should be a single line and show ellipsis when it does not fit.",
        "- Long paragraphs should wrap within the notification detail panel.",
        "- Long list items should also wrap without forcing horizontal page scroll or clipping the action row near the bottom of the view.",
        "- Inline code such as `listen-mobile-overflow-validation-inline-code-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` should remain inside the viewport.",
        "- Links like https://example.com/listen/mobile-overflow-validation/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc should break instead of stretching the layout.",
        "",
        "## Options table",
        "",
        "| Scenario | Expected result | Long cell content |",
        "| --- | --- | --- |",
        "| Long title | Header uses ellipsis | The detail header must not expand past the right edge of the viewport even when the title keeps going for a long time. |",
        "| Long paragraph | Body wraps | Paragraph content should wrap inside the panel and leave the Delete and Back buttons fully visible. |",
        "| Long token | Body breaks safely | dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd |",
        "",
        "## Code block",
        "",
        "```text",
        "bun run build && bun run test",
        "This code block is allowed to scroll horizontally inside its own box, but it must not make the entire page wider than the mobile viewport.",
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "```",
        "",
        "## More detail",
        "",
        "The bottom of this notification should still show action buttons fully inside the viewport. If the Delete button is clipped, the page is still using an unsafe intrinsic width from one of the markdown descendants.",
        "",
        "Another paragraph adds vertical distance so screenshot validation can inspect both the top title area and the lower action area after scrolling. The expected result is stable: no horizontal clipping, no hidden action button edge, and no text measuring wider than its parent panel.",
      ].join("\n"),
    },
    {
      title: "Agent finished",
      shortDescription: "The coding agent completed its assigned task.",
      markdownContent: "## Summary\n\nThe requested implementation finished successfully.\n\n- Build passed\n- Tests passed\n- Ready for review",
    },
    {
      title: "A long notification title that wraps cleanly across multiple lines in the inbox row",
      shortDescription: "This notification validates that long titles remain readable without breaking row controls or source metadata.",
      markdownContent: "### Long title check\n\nThe row should keep actions aligned while the title wraps.",
    },
    {
      title: "Review requested",
      shortDescription: "This intentionally long short description checks wrapping and truncation behavior in the notification list. It should remain readable, keep source and timestamp metadata visible, and avoid forcing horizontal scrolling on small screens.",
      markdownContent: "Please review the latest changes and confirm the behavior.",
    },
    {
      title: "Markdown table",
      shortDescription: "A table-heavy notification for detail view styling.",
      markdownContent: "| Check | Status |\n| --- | --- |\n| TypeScript | Passed |\n| API | Passed |\n| UI | Needs review |",
    },
    {
      title: "Code block output",
      shortDescription: "Build logs include a code block.",
      markdownContent: "```text\nbun run build\nBuild completed successfully\n```",
    },
    {
      title: "Link included",
      shortDescription: "External links should render safely.",
      markdownContent: "Open [GitHub](https://github.com/pablozaiden/listen) for repository context.",
    },
    {
      title: "PNG icon notification",
      shortDescription: "This notification includes a valid PNG data URL icon.",
      markdownContent: "> Icons are optional, but this one validates avatar rendering.",
      icon: DEMO_ICON,
    },
    {
      title: "Release staged",
      shortDescription: "Release automation prepared a candidate build.",
      markdownContent: "## Release notes\n\n1. Build artifact created\n2. Checksums generated\n3. Docker image ready",
    },
  ];

  return Array.from({ length: count }, (_, index) => {
    const template = templates[index % templates.length];
    return {
      ...template,
      title: count > templates.length ? `${template.title} #${index + 1}` : template.title,
    };
  });
}

async function main(): Promise<void> {
  const baseUrl = envString("LISTEN_BASE_URL", "http://127.0.0.1:3000").replace(/\/+$/, "");
  const sourceCount = envInteger("LISTEN_DEMO_SOURCE_COUNT", 4);
  const notificationCount = envInteger("LISTEN_DEMO_NOTIFICATION_COUNT", 30);
  const reset = envBoolean("LISTEN_DEMO_RESET");

  if (reset) {
    await apiJson(`${baseUrl}/api/notifications`, { method: "DELETE" }, "notification reset");
    console.warn("LISTEN_DEMO_RESET cleared notifications. It does not delete sources; use a fresh LISTEN_DATA_DIR for a fully clean demo dataset.");
  }

  const createdSources: SourceMutationResponse[] = [];
  for (const name of buildSourceNames(sourceCount)) {
    createdSources.push(await apiJson<SourceMutationResponse>(`${baseUrl}/api/sources`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }, "source creation"));
  }

  const notifications = demoNotifications(notificationCount);
  for (const [index, notification] of notifications.entries()) {
    const source = createdSources[index % createdSources.length];
    if (!source) {
      throw new Error("No demo sources were created");
    }
    await apiJson(source.webhookUrl, {
      method: "POST",
      body: JSON.stringify(notification),
    }, "webhook delivery");
  }

  console.log("Created demo sources:");
  for (const source of createdSources) {
    console.log(`- ${source.source.name}`);
  }
  console.log(`Created notifications: ${notifications.length}`);
  console.log(`Open Listen: ${baseUrl}/`);
  console.warn("Generated webhook URLs are one-time secrets and should be used only with local/dev data.");
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Tip: for local demo seeding, start the server with LISTEN_DISABLE_PASSKEY=true and a temporary LISTEN_DATA_DIR.");
  process.exit(1);
});
