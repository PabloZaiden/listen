import type { SourceResponse } from "@listen/contracts";

interface CreatedSource {
  source: SourceResponse;
  webhookUrl: string;
}

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

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
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
    throw new Error(`${message} (${url})`);
  }
  return response.json() as Promise<T>;
}

function buildSourceNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => DEFAULT_SOURCE_NAMES[index] ?? `Demo Source ${index + 1}`);
}

function demoNotifications(count: number): DemoNotification[] {
  const templates: DemoNotification[] = [
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
    await apiJson(`${baseUrl}/api/notifications`, { method: "DELETE" });
    console.warn("LISTEN_DEMO_RESET cleared notifications. Sources are soft-disabled only by the app API; use a fresh LISTEN_DATA_DIR for a fully clean demo dataset.");
  }

  const createdSources: CreatedSource[] = [];
  for (const name of buildSourceNames(sourceCount)) {
    createdSources.push(await apiJson<CreatedSource>(`${baseUrl}/api/sources`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }));
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
    });
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
