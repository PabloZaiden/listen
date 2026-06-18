import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { PasskeyAuthStatusResponse } from "@listen/contracts";
import {
  deletePasskeyCredential,
  getPasskeyCredential,
  insertPasskeyCredential,
  updatePasskeyCredentialUse,
  type PersistedPasskeyCredential,
} from "../persistence/passkey-auth";
import { getPreference, setPreference } from "../persistence/preferences";
import { getRequestOrigin } from "./request-origin";
import type { ServerConfig } from "./server-config";

const PASSKEY_RP_NAME = "Listen";
const PASSKEY_USER_NAME = "listen";
const PASSKEY_USER_DISPLAY_NAME = "Listen";
const PASSKEY_USER_ID = new Uint8Array(Buffer.from("listen"));
const PASSKEY_SESSION_COOKIE = "listen_passkey_session";
const PASSKEY_CHALLENGE_COOKIE = "listen_passkey_challenge";
const PASSKEY_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSKEY_CHALLENGE_MAX_AGE_SECONDS = 60 * 10;
const PASSKEY_AUTH_SECRET_KEY = "passkeyAuthSecret";
const PASSKEY_AUTH_VERSION_KEY = "passkeyAuthVersion";

interface SessionPayload {
  nonce: string;
  version: number;
  expiresAt: number;
}

interface ChallengePayload {
  challenge: string;
  type: "registration" | "authentication";
  expiresAt: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function getAuthSecret(): string {
  const existing = getPreference(PASSKEY_AUTH_SECRET_KEY);
  if (existing) {
    return existing;
  }
  const secret = randomSecret();
  setPreference(PASSKEY_AUTH_SECRET_KEY, secret);
  return secret;
}

function getAuthVersion(): number {
  const raw = getPreference(PASSKEY_AUTH_VERSION_KEY);
  if (!raw) {
    setPreference(PASSKEY_AUTH_VERSION_KEY, "1");
    return 1;
  }
  const version = Number(raw);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

function bumpAuthVersion(): number {
  const version = getAuthVersion() + 1;
  setPreference(PASSKEY_AUTH_VERSION_KEY, String(version));
  return version;
}

async function signPayload(encodedPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return Buffer.from(signature).toString("base64url");
}

async function encodeSignedPayload(payload: unknown): Promise<string> {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${await signPayload(encoded)}`;
}

async function decodeSignedPayload<T>(value: string | undefined): Promise<T | undefined> {
  if (!value) {
    return undefined;
  }
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) {
    return undefined;
  }
  const expected = await signPayload(encodedPayload);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function getCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.get("cookie");
  if (!cookie) {
    return undefined;
  }
  for (const part of cookie.split(";")) {
    const [rawName, ...valueParts] = part.trim().split("=");
    if (rawName === name) {
      return valueParts.join("=");
    }
  }
  return undefined;
}

function cookieHeader(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function expiredCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

async function createSessionCookie(req: Request): Promise<string> {
  const payload: SessionPayload = {
    nonce: randomSecret(),
    version: getAuthVersion(),
    expiresAt: Date.now() + PASSKEY_SESSION_MAX_AGE_SECONDS * 1000,
  };
  return cookieHeader(PASSKEY_SESSION_COOKIE, await encodeSignedPayload(payload), PASSKEY_SESSION_MAX_AGE_SECONDS, getRequestOrigin(req).secure);
}

async function createChallengeCookie(req: Request, payload: ChallengePayload): Promise<string> {
  return cookieHeader(PASSKEY_CHALLENGE_COOKIE, await encodeSignedPayload(payload), PASSKEY_CHALLENGE_MAX_AGE_SECONDS, getRequestOrigin(req).secure);
}

export async function getChallenge(req: Request, type: ChallengePayload["type"]): Promise<ChallengePayload | undefined> {
  const payload = await decodeSignedPayload<ChallengePayload>(getCookie(req, PASSKEY_CHALLENGE_COOKIE));
  if (!payload || payload.type !== type || payload.expiresAt < Date.now()) {
    return undefined;
  }
  return payload;
}

export async function hasValidPasskeySession(req: Request): Promise<boolean> {
  const payload = await decodeSignedPayload<SessionPayload>(getCookie(req, PASSKEY_SESSION_COOKIE));
  return Boolean(payload && payload.expiresAt >= Date.now() && payload.version === getAuthVersion());
}

export async function passkeyStatus(req: Request, config: Pick<ServerConfig, "passkeyDisabled">): Promise<PasskeyAuthStatusResponse> {
  return {
    passkeyConfigured: Boolean(getPasskeyCredential()),
    passkeyDisabled: config.passkeyDisabled,
    passkeyRequired: !config.passkeyDisabled,
    authenticated: config.passkeyDisabled || await hasValidPasskeySession(req),
  };
}

export async function registrationOptions(req: Request): Promise<{ options: unknown; headers: Headers }> {
  if (getPasskeyCredential()) {
    throw new Error("Passkey is already configured");
  }
  const origin = getRequestOrigin(req);
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID: origin.rpID,
    userID: PASSKEY_USER_ID,
    userName: PASSKEY_USER_NAME,
    userDisplayName: PASSKEY_USER_DISPLAY_NAME,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  const headers = new Headers();
  headers.append("set-cookie", await createChallengeCookie(req, {
    challenge: options.challenge,
    type: "registration",
    expiresAt: Date.now() + PASSKEY_CHALLENGE_MAX_AGE_SECONDS * 1000,
  }));
  return { options, headers };
}

export async function verifyRegistration(req: Request, response: RegistrationResponseJSON): Promise<Headers> {
  const challenge = await getChallenge(req, "registration");
  if (!challenge || getPasskeyCredential()) {
    throw new Error("Registration challenge is invalid or expired");
  }
  const origin = getRequestOrigin(req);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin.origin,
    expectedRPID: origin.rpID,
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration failed");
  }
  const info = verification.registrationInfo;
  const publicKey: Uint8Array<ArrayBuffer> = new Uint8Array(info.credential.publicKey.byteLength);
  publicKey.set(info.credential.publicKey);
  const credential: PersistedPasskeyCredential = {
    id: crypto.randomUUID(),
    name: PASSKEY_USER_NAME,
    credentialId: info.credential.id,
    publicKey,
    counter: info.credential.counter,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    transports: response.response.transports ?? [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  insertPasskeyCredential(credential);
  const headers = new Headers();
  headers.append("set-cookie", await createSessionCookie(req));
  headers.append("set-cookie", expiredCookieHeader(PASSKEY_CHALLENGE_COOKIE));
  return headers;
}

export async function authenticationOptions(req: Request): Promise<{ options: unknown; headers: Headers }> {
  const credential = getPasskeyCredential();
  if (!credential) {
    throw new Error("No passkey is configured");
  }
  const origin = getRequestOrigin(req);
  const options = await generateAuthenticationOptions({
    rpID: origin.rpID,
    allowCredentials: [{
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransport[],
    }],
    userVerification: "preferred",
  });
  const headers = new Headers();
  headers.append("set-cookie", await createChallengeCookie(req, {
    challenge: options.challenge,
    type: "authentication",
    expiresAt: Date.now() + PASSKEY_CHALLENGE_MAX_AGE_SECONDS * 1000,
  }));
  return { options, headers };
}

export async function verifyAuthentication(req: Request, response: AuthenticationResponseJSON): Promise<Headers> {
  const challenge = await getChallenge(req, "authentication");
  const credential = getPasskeyCredential();
  if (!challenge || !credential) {
    throw new Error("Authentication challenge is invalid or expired");
  }
  const origin = getRequestOrigin(req);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin.origin,
    expectedRPID: origin.rpID,
    credential: {
      id: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports as AuthenticatorTransport[],
    },
    requireUserVerification: false,
  });
  if (!verification.verified) {
    throw new Error("Passkey authentication failed");
  }
  updatePasskeyCredentialUse(credential.id, verification.authenticationInfo.newCounter, nowIso());
  const headers = new Headers();
  headers.append("set-cookie", await createSessionCookie(req));
  headers.append("set-cookie", expiredCookieHeader(PASSKEY_CHALLENGE_COOKIE));
  return headers;
}

export function logoutHeaders(): Headers {
  const headers = new Headers();
  headers.append("set-cookie", expiredCookieHeader(PASSKEY_SESSION_COOKIE));
  headers.append("set-cookie", expiredCookieHeader(PASSKEY_CHALLENGE_COOKIE));
  return headers;
}

export function deleteConfiguredPasskey(): Headers {
  deletePasskeyCredential();
  bumpAuthVersion();
  return logoutHeaders();
}

export function isPasskeyConfigured(): boolean {
  return Boolean(getPasskeyCredential());
}
