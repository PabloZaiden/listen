export function normalizeMarkdownForDisplay(markdown: string): string {
  if (markdown.includes("\n")) {
    return markdown;
  }

  return markdown
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\n");
}