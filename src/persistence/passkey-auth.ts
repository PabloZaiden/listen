import { getDatabase } from "./database";

export interface PersistedPasskeyCredential {
  id: string;
  name: string;
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

interface PasskeyCredentialRow {
  id: string;
  name: string;
  credential_id: string;
  public_key: Uint8Array<ArrayBuffer>;
  counter: number;
  device_type: string;
  backed_up: number;
  transports: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

function mapCredential(row: PasskeyCredentialRow): PersistedPasskeyCredential {
  return {
    id: row.id,
    name: row.name,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: row.counter,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    transports: JSON.parse(row.transports) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}

export function getPasskeyCredential(): PersistedPasskeyCredential | undefined {
  const row = getDatabase().query("SELECT * FROM passkey_credentials ORDER BY created_at ASC LIMIT 1").get() as PasskeyCredentialRow | null;
  return row ? mapCredential(row) : undefined;
}

export function insertPasskeyCredential(credential: PersistedPasskeyCredential): void {
  getDatabase().query(`
    INSERT INTO passkey_credentials (
      id, name, credential_id, public_key, counter, device_type, backed_up, transports, created_at, updated_at, last_used_at
    )
    VALUES ($id, $name, $credentialId, $publicKey, $counter, $deviceType, $backedUp, $transports, $createdAt, $updatedAt, $lastUsedAt)
  `).run({
    id: credential.id,
    name: credential.name,
    credentialId: credential.credentialId,
    publicKey: credential.publicKey,
    counter: credential.counter,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp ? 1 : 0,
    transports: JSON.stringify(credential.transports),
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    lastUsedAt: credential.lastUsedAt ?? null,
  });
}

export function updatePasskeyCredentialUse(id: string, counter: number, lastUsedAt: string): void {
  getDatabase().query(`
    UPDATE passkey_credentials
    SET counter = $counter, last_used_at = $lastUsedAt, updated_at = $lastUsedAt
    WHERE id = $id
  `).run({ id, counter, lastUsedAt });
}

export function deletePasskeyCredential(): void {
  getDatabase().query("DELETE FROM passkey_credentials").run();
}
