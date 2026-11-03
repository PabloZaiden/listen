import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

type CborValue = number | string | Uint8Array | Map<string | number, CborValue>;
interface RegistrationOptions { challenge: string; rp: { id?: string } }
interface AuthenticationOptions { challenge: string; rpId?: string }

export interface FixturePasskey {
  id: string;
  publicKey: Uint8Array;
  privateKey: KeyObject;
  counter: number;
}

export function fixturePasskey(): FixturePasskey {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Missing fixture public coordinates");
  return {
    id: crypto.randomUUID(),
    publicKey: Uint8Array.from(isoCBOR.encode(new Map<string | number, CborValue>([
      [1, 2], [3, -7], [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
    ]))),
    privateKey: pair.privateKey,
    counter: 0,
  };
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function authenticatorData(rpID: string, flags: number, counter: number): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  return Buffer.concat([createHash("sha256").update(rpID).digest(), Buffer.from([flags]), count]);
}

export function registrationResponse(passkey: FixturePasskey, options: RegistrationOptions, origin: string) {
  if (!options.rp.id) throw new Error("Registration options have no RP ID");
  const id = Buffer.from(passkey.id);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(id.length);
  const data = Buffer.concat([
    authenticatorData(options.rp.id, 0x45, 0), Buffer.alloc(16), length, id, passkey.publicKey,
  ]);
  const encodedId = id.toString("base64url");
  return {
    id: encodedId, rawId: encodedId, type: "public-key", authenticatorAttachment: "platform",
    clientExtensionResults: { credProps: { rk: true } },
    response: {
      attestationObject: Buffer.from(isoCBOR.encode(new Map<string | number, CborValue>([
        ["fmt", "none"], ["attStmt", new Map<string | number, CborValue>()], ["authData", new Uint8Array(data)],
      ]))).toString("base64url"),
      clientDataJSON: clientData("webauthn.create", options.challenge, origin).toString("base64url"),
      transports: ["internal"],
      publicKeyAlgorithm: -7,
    },
  };
}

export function authenticationResponse(passkey: FixturePasskey, options: AuthenticationOptions, origin: string) {
  const data = authenticatorData(options.rpId ?? new URL(origin).hostname, 0x05, ++passkey.counter);
  const client = clientData("webauthn.get", options.challenge, origin);
  const signature = sign("sha256", Buffer.concat([data, createHash("sha256").update(client).digest()]), passkey.privateKey);
  return {
    id: passkey.id, rawId: passkey.id, type: "public-key", clientExtensionResults: {},
    response: {
      authenticatorData: data.toString("base64url"),
      clientDataJSON: client.toString("base64url"),
      signature: signature.toString("base64url"),
    },
  };
}
