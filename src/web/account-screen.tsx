import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { startAuthentication, startRegistration } from "@pablozaiden/webapp/auth/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@pablozaiden/webapp/auth/browser";
import { appJson, Button, ErrorState, FormGroup, FormSection, Input, LoadingState, Page, WebAppRoot } from "@pablozaiden/webapp/web";
import { accountStatusResponseSchema } from "@listen/contracts";
import { acceptAccount, refreshAccount, useAccountState } from "./account-runtime";
import listenLogo from "./icons/listen.svg";

export async function enrollPasskey(replace: boolean, username?: string): Promise<void> {
  const path = replace ? "/api/account/passkey" : "/api/account/bootstrap";
  const ceremony = await appJson<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(`${path}/options`, {
    method: "POST",
    ...(replace ? {} : { body: JSON.stringify({ username }) }),
  });
  const response = await startRegistration({ optionsJSON: ceremony.options });
  acceptAccount(accountStatusResponseSchema.parse(await appJson(`${path}/verify`, {
    method: "POST", body: JSON.stringify({ challengeId: ceremony.challengeId, response }),
  })), true);
}

async function login(): Promise<void> {
  const ceremony = await appJson<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>("/api/account/login/options", { method: "POST" });
  const response = await startAuthentication({ optionsJSON: ceremony.options });
  acceptAccount(accountStatusResponseSchema.parse(await appJson("/api/account/login/verify", {
    method: "POST", body: JSON.stringify({ challengeId: ceremony.challengeId, response }),
  })), true);
}

function AccountScreen() {
  const { account, error: loadError } = useAccountState();
  const [username, setUsername] = useState("owner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const bootstrap = account?.bootstrapRequired;
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (bootstrap) await enrollPasskey(false, username);
      else await login();
    } catch (value) {
      setError(value instanceof Error ? value : new Error(String(value)));
    } finally {
      setBusy(false);
    }
  }
  return <Page>
    {!account && !loadError ? <LoadingState /> : null}
    {loadError ? <ErrorState description={loadError.message} action={<Button onClick={() => { void refreshAccount(); }}>Retry</Button>} /> : null}
    {account ? <FormSection title={bootstrap ? "Set up Listen" : "Sign in"}>
      <form onSubmit={(event) => { void submit(event); }}>
        {bootstrap ? <FormGroup title="Owner name">
          <label htmlFor="owner-name">Name</label>
          <Input id="owner-name" value={username} required maxLength={64} pattern={"[A-Za-z0-9][A-Za-z0-9_.\\-]*"} autoComplete="username"
            disabled={busy} onChange={(event) => setUsername(event.target.value)} />
        </FormGroup> : null}
        {error ? <ErrorState description={error.message} /> : null}
        <Button type="submit" loading={busy} disabled={busy}>{bootstrap ? "Create owner passkey" : "Sign in with passkey"}</Button>
      </form>
    </FormSection> : null}
  </Page>;
}

export function AccountGate({ children }: { children: ReactNode }) {
  const { account } = useAccountState();
  useEffect(() => { void refreshAccount(); }, []);
  if (account?.authenticated) return <>{children}</>;
  const screen = () => <AccountScreen />;
  return <WebAppRoot appName="Listen" appIcon={listenLogo} homeRoute={{ view: "inbox" }}
    sidebar={{ getNodes: () => [], search: false, pinning: false }}
    routes={{ inbox: screen, sources: screen, notification: screen, settings: screen }}
    header={{ renderTitle: () => "Listen" }} />;
}
