export function normalizeMarkdownForDisplay(markdown: string): string {
  if (/[\r\n]/.test(markdown)) {
    return markdown;
  }

  return markdown
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\n");
}