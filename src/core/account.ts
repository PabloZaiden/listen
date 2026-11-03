import { createBrowserSessions, createPasskeyAuth, type PasskeyIdentity } from "@pablozaiden/webapp/auth";
import { getRequestOriginInfo, type RuntimeConfig } from "@pablozaiden/webapp/server";
import { getAccountPreference, getOwner, requireOwner, setAccountPreference, type OwnerAccount } from "../persistence/account";
import { consumeChallenge, getPasskey, getPendingOwner, getSessionSecret, isSessionValid, revokeSession, saveChallenge, saveCredential, saveSession, updateCredential } from "../persistence/auth";
import type { BrowserSession } from "@pablozaiden/webapp/auth";

export type { OwnerAccount } from "../persistence/account";

function findIdentity(id: string): OwnerAccount | undefined {
  const owner = getOwner();
  return owner?.id === id ? owner : undefined;
}

export function accountSessions(req: Request, config: RuntimeConfig) {
  return createBrowserSessions<OwnerAccount>({
    secret: getSessionSecret,
    origin: getRequestOriginInfo(req, config).origin,
    cookie: { name: "listen_session", path: "/", maxAgeSeconds: 30 * 24 * 60 * 60 },
    getIdentity: findIdentity,
    getVersion: (owner) => owner.authVersion,
    isSessionValid,
    onCreate: saveSession,
    onRevoke: revokeSession,
  });
}

export function accountPasskeys(
  req: Request,
  config: RuntimeConfig,
  allowAttempt: (request: Request) => boolean,
  options: { bootstrap?: boolean; pendingOwner?: OwnerAccount } = {},
) {
  const origin = getRequestOriginInfo(req, config);
  return createPasskeyAuth({
    origin: origin.origin,
    rpID: origin.hostname,
    rpName: "Listen",
    requireUserVerification: false,
    getIdentity(id): PasskeyIdentity | undefined {
      const owner = findIdentity(id) ?? options.pendingOwner;
      return owner?.id === id ? {
        id: owner.id,
        username: owner.username,
        userHandle: new Uint8Array(Buffer.from(owner.id)),
        version: owner.authVersion,
      } : undefined;
    },
    listCredentials(identityId) {
      const passkey = getPasskey();
      return passkey && (identityId === undefined || passkey.identityId === identityId) ? [passkey] : [];
    },
    getCredential(id) {
      const passkey = getPasskey();
      return passkey?.credentialId === id ? passkey : undefined;
    },
    saveChallenge: (challenge) => saveChallenge(challenge, options.pendingOwner),
    consumeChallenge,
    saveCredential: (credential, version) => saveCredential(credential, version, options.pendingOwner, options.bootstrap === true),
    updateCredential,
    allowAttempt: ({ request }) => allowAttempt(request),
  });
}

export function bootstrapOwner(username: string): OwnerAccount | undefined {
  if (getPasskey()) return undefined;
  return getOwner() ?? { id: crypto.randomUUID(), username, authVersion: 1 };
}

export function pendingBootstrapOwner(challengeId: string): OwnerAccount | undefined {
  if (getPasskey()) return undefined;
  return getPendingOwner(challengeId);
}

export function currentOwner(): OwnerAccount | undefined {
  return getOwner();
}

export function accountStatus(owner?: OwnerAccount) {
  return {
    authenticated: Boolean(owner),
    bootstrapRequired: !getPasskey(),
    ...(owner ? {
      owner: { username: owner.username },
      theme: getAccountPreference("theme"),
    } : {}),
  };
}

export function saveOwnerTheme(owner: OwnerAccount, theme: "dark" | "light" | "system"): void {
  requireOwner(owner);
  setAccountPreference("theme", theme);
}

export function ownerSessionActive(owner: OwnerAccount, session: BrowserSession): boolean {
  const current = getOwner();
  return current?.id === owner.id && current.authVersion === owner.authVersion && isSessionValid(session);
}
