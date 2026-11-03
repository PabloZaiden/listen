import type { SourceMutationResponse, SourceResponse } from "@listen/contracts";
import { requireOwner, type OwnerAccount } from "../persistence/account";
import { createLogger } from "@pablozaiden/webapp/server";
import {
  deleteSource,
  getSourceById,
  getSourceByIdForWebhook,
  insertSource,
  listSources as listPersistedSources,
  updateSourceLastUsedAt,
  updateSourceTokenHash,
  type PersistedSource,
} from "../persistence/sources";
import { generateWebhookToken, hashWebhookToken } from "./webhook-tokens";

const log = createLogger("sources");

function nowIso(): string {
  return new Date().toISOString();
}

export function toSourceResponse(source: PersistedSource): SourceResponse {
  return {
    id: source.id,
    name: source.name,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastUsedAt: source.lastUsedAt,
  };
}

export function buildWebhookUrl(publicBaseUrl: string, sourceId: string, token: string): string {
  return `${publicBaseUrl}/api/webhooks/${sourceId}/${token}`;
}

export async function createSource(name: string, publicBaseUrl: string, owner: OwnerAccount): Promise<SourceMutationResponse> {
  const ownerId = requireOwner(owner);
  const token = generateWebhookToken();
  const source: PersistedSource = {
    id: crypto.randomUUID(),
    userId: ownerId,
    name,
    tokenHash: await hashWebhookToken(token),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  insertSource(source, owner);
  const response = toSourceResponse(source);
  log.info("Source created", { sourceId: source.id, userId: ownerId, name: source.name });
  return {
    source: response,
    webhookUrl: buildWebhookUrl(publicBaseUrl, source.id, token),
  };
}

export function listSources(owner: OwnerAccount): SourceResponse[] {
  return listPersistedSources(owner).map(toSourceResponse);
}

export function getSourceForWebhook(id: string): PersistedSource | undefined {
  return getSourceByIdForWebhook(id);
}

export async function rotateSourceToken(id: string, publicBaseUrl: string, owner: OwnerAccount): Promise<SourceMutationResponse | undefined> {
  const existing = getSourceById(id, owner);
  if (!existing) {
    log.warn("Source token rotation requested but source was not found", { sourceId: id });
    return undefined;
  }
  const token = generateWebhookToken();
  const updated = updateSourceTokenHash(id, await hashWebhookToken(token), nowIso(), owner);
  if (!updated) {
    log.warn("Source token rotation failed after lookup", { sourceId: id });
    return undefined;
  }
  const response = toSourceResponse(updated);
  log.info("Source token rotated", { sourceId: id });
  return {
    source: response,
    webhookUrl: buildWebhookUrl(publicBaseUrl, id, token),
  };
}

export function markSourceUsed(id: string, owner: OwnerAccount, usedAt = nowIso()): SourceResponse | undefined {
  const source = updateSourceLastUsedAt(id, usedAt, owner);
  if (!source) {
    log.warn("Source last-used update failed", { sourceId: id });
    return undefined;
  }
  const response = toSourceResponse(source);
  return response;
}

export function deleteSourceAndNotifications(id: string, owner: OwnerAccount): boolean {
  const deleted = deleteSource(id, owner);
  if (!deleted) {
    log.warn("Source delete requested but source was not found", { sourceId: id });
    return false;
  }
  log.info("Source deleted", { sourceId: id, deletedNotificationCount: deleted.deletedNotificationCount });
  return true;
}
