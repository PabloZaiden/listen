import { useSyncExternalStore } from "react";
import {
  appJson, configureWebAppClient, configureWebAppPreferences, createBrowserPreferenceAdapter,
  initializeWebAppTheme, onAuthRequired, type WebAppClientRuntime, type WebAppRuntimeSnapshot,
} from "@pablozaiden/webapp/web";
import { accountStatusResponseSchema, type AccountStatus } from "@listen/contracts";

const listeners = new Set<() => void>();
let state: { account?: AccountStatus; error?: Error } = {};
let runtimeSnapshot: WebAppRuntimeSnapshot = { scope: "listen:anonymous", generation: 0, ready: false, logLevel: "info" };

function publish(): void {
  for (const listener of listeners) listener();
}

export function acceptAccount(account: AccountStatus, sessionChanged = false): void {
  const changed = account.authenticated !== state.account?.authenticated;
  state = { account };
  configureWebAppClient({ realtimePath: account.authenticated ? "/api/ws" : false });
  runtimeSnapshot = {
    ...runtimeSnapshot,
    scope: account.authenticated ? `listen:${location.origin}:owner` : "listen:anonymous",
    generation: runtimeSnapshot.generation + (changed || sessionChanged ? 1 : 0),
    ready: true,
    error: undefined,
  };
  publish();
}

export async function refreshAccount(): Promise<void> {
  try {
    acceptAccount(accountStatusResponseSchema.parse(await appJson("/api/account")));
  } catch (error) {
    state = { ...state, error: error instanceof Error ? error : new Error(String(error)) };
    runtimeSnapshot = { ...runtimeSnapshot, ready: true };
    publish();
  }
}

const runtime: WebAppClientRuntime = {
  getSnapshot: () => runtimeSnapshot,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  refresh: refreshAccount,
};

const preferenceAdapter = createBrowserPreferenceAdapter();
configureWebAppPreferences({ adapter: preferenceAdapter, scope: () => "", themeStorageKey: "webapp.theme" });
initializeWebAppTheme();
configureWebAppClient({ runtime, realtimePath: false });
onAuthRequired(() => acceptAccount({ authenticated: false, bootstrapRequired: state.account?.bootstrapRequired ?? false }));

export function useAccountState() {
  return useSyncExternalStore(runtime.subscribe, () => state, () => state);
}

export const ownerThemeAdapter = {
  async load(): Promise<"dark" | "light" | "system"> {
    const account = accountStatusResponseSchema.parse(await appJson("/api/account"));
    const local = preferenceAdapter.getItem("webapp.theme");
    return account.theme ?? (local === "light" || local === "system" ? local : "dark");
  },
  async save(theme: "dark" | "light" | "system"): Promise<void> {
    await appJson("/api/account/theme", { method: "PUT", body: JSON.stringify({ theme }) });
  },
};
