import type { SourceMutationResponse, SourceResponse } from "@listen/contracts";
import { requireUserId } from "@listen/shared";
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
import { createLogger } from "./logger";

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
    disabledAt: source.disabledAt,
  };
}

export function buildWebhookUrl(publicBaseUrl: string, sourceId: string, token: string): string {
  return `${publicBaseUrl}/api/webhooks/${sourceId}/${token}`;
}

export async function createSource(name: string, publicBaseUrl: string, userId: string): Promise<SourceMutationResponse> {
  const ownerId = requireUserId(userId);
  const token = generateWebhookToken();
  const source: PersistedSource = {
    id: crypto.randomUUID(),
    userId: ownerId,
    name,
    tokenHash: await hashWebhookToken(token),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  insertSource(source);
  const response = toSourceResponse(source);
  log.info("Source created", { sourceId: source.id, userId: ownerId, name: source.name });
  return {
    source: response,
    webhookUrl: buildWebhookUrl(publicBaseUrl, source.id, token),
  };
}

export function listSources(includeDisabled: boolean, userId: string): SourceResponse[] {
  return listPersistedSources(includeDisabled, requireUserId(userId)).map(toSourceResponse);
}

export function getSourceForWebhook(id: string): PersistedSource | undefined {
  return getSourceByIdForWebhook(id);
}

export async function rotateSourceToken(id: string, publicBaseUrl: string, userId: string): Promise<SourceMutationResponse | undefined> {
  const ownerId = requireUserId(userId);
  const existing = getSourceById(id, ownerId);
  if (!existing) {
    log.warn("Source token rotation requested but source was not found", { sourceId: id });
    return undefined;
  }
  const token = generateWebhookToken();
  const updated = updateSourceTokenHash(id, await hashWebhookToken(token), nowIso(), ownerId);
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

export function markSourceUsed(id: string, userId: string, usedAt = nowIso()): SourceResponse | undefined {
  const ownerId = requireUserId(userId);
  const source = updateSourceLastUsedAt(id, usedAt, ownerId);
  if (!source) {
    log.warn("Source last-used update failed", { sourceId: id });
    return undefined;
  }
  const response = toSourceResponse(source);
  return response;
}

export function deleteSourceAndNotifications(id: string, userId: string): boolean {
  const ownerId = requireUserId(userId);
  const deleted = deleteSource(id, ownerId);
  if (!deleted) {
    log.warn("Source delete requested but source was not found", { sourceId: id });
    return false;
  }
  log.info("Source deleted", { sourceId: id, deletedNotificationCount: deleted.deletedNotificationCount });
  return true;
}
