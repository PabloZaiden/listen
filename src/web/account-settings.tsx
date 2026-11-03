import { useState } from "react";
import { appJson, Button, ThemeSelect, useToast, type SettingsSection } from "@pablozaiden/webapp/web";
import { acceptAccount } from "./account-runtime";
import { enrollPasskey } from "./account-screen";
import { BrowserPushSettings } from "./browserPushSettings";

export function useAccountSettings(): SettingsSection[] {
  const [busy, setBusy] = useState<"passkey" | "logout">();
  const toast = useToast();
  async function run(action: "passkey" | "logout"): Promise<void> {
    if (busy) return;
    setBusy(action);
    try {
      if (action === "passkey") {
        await enrollPasskey(true);
        toast.success("Passkey replaced.");
      } else {
        await appJson("/api/account/logout", { method: "POST" });
        acceptAccount({ authenticated: false, bootstrapRequired: false });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Account action failed");
    } finally {
      setBusy(undefined);
    }
  }
  return [
    { id: "appearance", title: "Appearance", rows: [{ id: "theme", title: "Theme", content: <ThemeSelect /> }] },
    { id: "account", title: "Account", rows: [
      { id: "passkey", title: "Passkey", actions: [{
        id: "replace-passkey", label: "Replace passkey", pending: busy === "passkey", disabled: Boolean(busy),
        confirmation: { title: "Replace passkey?", message: "Other browser sessions will be signed out.", confirmLabel: "Replace" },
        onAction: () => run("passkey"),
      }] },
      { id: "logout", title: "Session", actions: <Button disabled={Boolean(busy)} loading={busy === "logout"} onClick={() => { void run("logout"); }}>Log out</Button> },
    ] },
    {
      id: "browser-push", title: "Browser notifications",
      // Browser permission and subscription states require the existing interactive push panel.
      render: () => <BrowserPushSettings />,
    },
  ];
}
