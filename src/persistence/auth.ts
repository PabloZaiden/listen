import { z } from "zod";
import type { BrowserSession, PasskeyChallenge, PasskeyCredential } from "@pablozaiden/webapp/auth";
import { getDatabase } from "./database";
import { createOwner, getAccountPreference, getOwner, setAccountPreference, type OwnerAccount } from "./account";

const challengeSchema = z.object({
  id: z.string(),
  challenge: z.string(),
  purpose: z.enum(["registration", "authentication"]),
  identityId: z.string().optional(),
  identityVersion: z.number().int().optional(),
  expiresAt: z.number(),
  pendingOwner: z.object({ id: z.string(), username: z.string(), authVersion: z.number().int() }).optional(),
});

interface PasskeyRow {
  credential_id: string;
  user_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string;
}

export function getPasskey(): PasskeyCredential | undefined {
  const row = getDatabase().query("SELECT credential_id, user_id, public_key, counter, transports FROM listen_passkey").get() as PasskeyRow | null;
  if (!row) return undefined;
  return {
    credentialId: row.credential_id,
    identityId: row.user_id,
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: z.array(z.string()).parse(JSON.parse(row.transports)),
  };
}

export function getSessionSecret(): Uint8Array {
  const db = getDatabase();
  return db.transaction(() => {
    let value = getAccountPreference("session.secret");
    if (!value) {
      value = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
      setAccountPreference("session.secret", value);
    }
    return new Uint8Array(Buffer.from(value, "base64url"));
  }).immediate();
}

export function saveChallenge(challenge: Readonly<PasskeyChallenge>, pendingOwner?: OwnerAccount): void {
  const db = getDatabase();
  db.transaction(() => {
    db.query("DELETE FROM listen_passkey_challenges WHERE expires_at <= ?").run(Date.now());
    const count = db.query("SELECT COUNT(*) AS count FROM listen_passkey_challenges").get() as { count: number };
    if (count.count >= 1000) throw new Error("Too many pending passkey challenges");
    db.query("INSERT INTO listen_passkey_challenges VALUES (?, ?, ?)").run(challenge.id, JSON.stringify({ ...challenge, pendingOwner }), challenge.expiresAt);
  }).immediate();
}

export function getPendingOwner(challengeId: string): OwnerAccount | undefined {
  const row = getDatabase().query("SELECT value FROM listen_passkey_challenges WHERE id = ? AND expires_at > ?").get(challengeId, Date.now()) as { value: string } | null;
  return row ? challengeSchema.parse(JSON.parse(row.value)).pendingOwner : undefined;
}

export function consumeChallenge(id: string, purpose: PasskeyChallenge["purpose"]): PasskeyChallenge | undefined {
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.query("DELETE FROM listen_passkey_challenges WHERE id = ? RETURNING value").get(id) as { value: string } | null;
    if (!row) return undefined;
    const value = challengeSchema.parse(JSON.parse(row.value));
    return value.purpose === purpose && value.expiresAt > Date.now() ? value : undefined;
  }).immediate();
}

export function saveCredential(credential: Readonly<PasskeyCredential>, expectedVersion: number, pendingOwner: OwnerAccount | undefined, bootstrap: boolean): number | false {
  const db = getDatabase();
  return db.transaction(() => {
    let owner = getOwner();
    if (bootstrap && getPasskey()) return false;
    if (!owner) {
      if (!bootstrap || !pendingOwner || credential.identityId !== pendingOwner.id || expectedVersion !== pendingOwner.authVersion) return false;
      owner = createOwner(pendingOwner.id, pendingOwner.username);
    }
    if (owner.id !== credential.identityId || owner.authVersion !== expectedVersion) return false;
    db.query("DELETE FROM listen_passkey WHERE user_id = ?").run(owner.id);
    const now = new Date().toISOString();
    db.query(`INSERT INTO listen_passkey
      (id,user_id,name,credential_id,public_key,counter,device_type,backed_up,transports,created_at,updated_at)
      VALUES (?,?,'Primary passkey',?,?,?,'singleDevice',0,?,?,?)`)
      .run(crypto.randomUUID(), owner.id, credential.credentialId, credential.publicKey, credential.counter, JSON.stringify(credential.transports ?? []), now, now);
    db.query("UPDATE listen_owner SET auth_version = auth_version + 1, updated_at = ? WHERE id = ?").run(now, owner.id);
    db.exec("DELETE FROM listen_sessions");
    return expectedVersion + 1;
  }).immediate();
}

export function updateCredential(expected: Readonly<PasskeyCredential>, counter: number, expectedVersion: number): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    const owner = getOwner();
    if (!owner || owner.id !== expected.identityId || owner.authVersion !== expectedVersion) return false;
    const now = new Date().toISOString();
    return db.query(`UPDATE listen_passkey SET counter = ?, last_used_at = ?, updated_at = ?
      WHERE credential_id = ? AND user_id = ? AND counter = ? AND public_key = ?`)
      .run(counter, now, now, expected.credentialId, owner.id, expected.counter, expected.publicKey).changes === 1;
  }).immediate();
}

export function saveSession(session: Readonly<BrowserSession>): void {
  const db = getDatabase();
  db.transaction(() => {
    db.query("DELETE FROM listen_sessions WHERE expires_at <= ?").run(Date.now());
    const owner = getOwner();
    if (!owner || owner.id !== session.identityId || owner.authVersion !== session.version) throw new Error("Account changed during session creation");
    db.query("INSERT INTO listen_sessions VALUES (?, ?, ?, ?)").run(session.id, session.identityId, session.version, session.expiresAt);
  }).immediate();
}

export function isSessionValid(session: Readonly<BrowserSession>): boolean {
  return Boolean(getDatabase().query("SELECT 1 FROM listen_sessions WHERE id = ? AND user_id = ? AND auth_version = ? AND expires_at > ?")
    .get(session.id, session.identityId, session.version, Date.now()));
}

export function revokeSession(session: Readonly<BrowserSession>): void {
  getDatabase().query("DELETE FROM listen_sessions WHERE id = ?").run(session.id);
}
