export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "listen-theme-preference";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readStoredThemePreference(storage: Pick<Storage, "getItem"> = window.localStorage): ThemePreference {
  const stored = storage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

export function resolveThemePreference(preference: ThemePreference, prefersDark: boolean): "light" | "dark" {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

export function applyThemePreference(preference: ThemePreference, root: HTMLElement = document.documentElement): void {
  root.dataset["theme"] = preference;
  const resolved = resolveThemePreference(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset["resolvedTheme"] = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#111827" : "#f8fafc");
}
