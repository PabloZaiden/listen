import type { SourceResponse } from "@listen/contracts";
import {
  disableSource,
  getSourceById,
  insertSource,
  listSources as listPersistedSources,
  updateSourceLastUsedAt,
  updateSourceTokenHash,
  type PersistedSource,
} from "../persistence/sources";
import { emit } from "./event-emitter";
import { generateWebhookToken, hashWebhookToken } from "./webhook-tokens";
import { getRequestOrigin } from "./request-origin";
import { createLogger } from "./logger";

const log = createLogger("sources");

export interface CreatedSource {
  source: SourceResponse;
  webhookUrl: string;
  token: string;
}

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

export function buildWebhookUrl(req: Request, sourceId: string, token: string): string {
  return `${getRequestOrigin(req).origin}/api/webhooks/${sourceId}/${token}`;
}

export async function createSource(name: string, req: Request): Promise<CreatedSource> {
  const token = generateWebhookToken();
  const source: PersistedSource = {
    id: crypto.randomUUID(),
    name,
    tokenHash: await hashWebhookToken(token),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  insertSource(source);
  const response = toSourceResponse(source);
  emit({ type: "source.created", source: response });
  log.info("Source created", { sourceId: source.id, name: source.name });
  return {
    source: response,
    token,
    webhookUrl: buildWebhookUrl(req, source.id, token),
  };
}

export function listSources(includeDisabled: boolean): SourceResponse[] {
  return listPersistedSources(includeDisabled).map(toSourceResponse);
}

export function getSourceForWebhook(id: string): PersistedSource | undefined {
  return getSourceById(id);
}

export async function rotateSourceToken(id: string, req: Request): Promise<CreatedSource | undefined> {
  const existing = getSourceById(id);
  if (!existing) {
    log.warn("Source token rotation requested but source was not found", { sourceId: id });
    return undefined;
  }
  const token = generateWebhookToken();
  const updated = updateSourceTokenHash(id, await hashWebhookToken(token), nowIso());
  if (!updated) {
    log.warn("Source token rotation failed after lookup", { sourceId: id });
    return undefined;
  }
  const response = toSourceResponse(updated);
  emit({ type: "source.updated", source: response });
  log.info("Source token rotated", { sourceId: id });
  return {
    source: response,
    token,
    webhookUrl: buildWebhookUrl(req, id, token),
  };
}

export function markSourceUsed(id: string, usedAt = nowIso()): SourceResponse | undefined {
  const source = updateSourceLastUsedAt(id, usedAt);
  if (!source) {
    log.warn("Source last-used update failed", { sourceId: id });
    return undefined;
  }
  const response = toSourceResponse(source);
  emit({ type: "source.updated", source: response });
  return response;
}

export function softDisableSource(id: string): boolean {
  const source = disableSource(id, nowIso());
  if (!source) {
    log.warn("Source disable requested but source was not found", { sourceId: id });
    return false;
  }
  emit({ type: "source.deleted", sourceId: id });
  log.info("Source disabled", { sourceId: id });
  return true;
}
