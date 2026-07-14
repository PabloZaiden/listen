import { useState } from "react";
import type { SourceResponse } from "@listen/contracts";
import { NOTIFICATION_SOURCE_NAME_MAX_CHARS } from "@listen/shared";
import {
  ActionMenu,
  Button,
  DataList,
  DataListRow,
  Page,
  Panel,
  TextField,
  useToast,
} from "@pablozaiden/webapp/web";
import { buildSourceActions } from "../actions/source-actions";
import type { ConfirmState } from "../hooks/use-confirmation";
import type { SourcesController } from "../hooks/use-sources";
import { mutationErrorMessage } from "../mutation-state";

export type SourcesViewProps = {
  sources: SourceResponse[];
  refreshSources: () => Promise<void>;
  createSource: SourcesController["createSource"];
  rotateSourceToken: SourcesController["rotateSourceToken"];
  deleteSourceRequest: SourcesController["deleteSource"];
  requestConfirm: (confirm: ConfirmState) => void;
};

export function SourcesView({
  sources,
  refreshSources,
  createSource,
  rotateSourceToken,
  deleteSourceRequest,
  requestConfirm,
}: SourcesViewProps) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function copyWebhook(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setError(undefined);
    } catch {
      setError("Could not copy the webhook URL. Copy it manually from the text above.");
    }
  }

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a source name.");
      return;
    }
    if (trimmed.length > NOTIFICATION_SOURCE_NAME_MAX_CHARS) {
      setError(`Source names must be ${NOTIFICATION_SOURCE_NAME_MAX_CHARS} characters or fewer.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await createSource(trimmed);
      setWebhookUrl(response.webhookUrl);
      setName("");
      try {
        await refreshSources();
      } catch (refreshError) {
        toast.error(mutationErrorMessage(refreshError, "Source created, but the source list could not be refreshed."));
      }
      toast.success("Source created. The webhook URL is shown below.");
    } catch (requestError) {
      const message = mutationErrorMessage(requestError, "Could not create source.");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function rotate(source: SourceResponse): void {
    requestConfirm({
      title: "Rotate source token?",
      description: `The old webhook URL for ${source.name} will stop working immediately.`,
      confirmLabel: "Rotate token",
      danger: true,
      successMessage: "Source token rotated. The new webhook URL is shown below.",
      action: async () => {
        const response = await rotateSourceToken(source.id);
        setWebhookUrl(response.webhookUrl);
        try {
          await refreshSources();
        } catch (refreshError) {
          toast.error(mutationErrorMessage(refreshError, "Source token rotated, but the source list could not be refreshed."));
        }
      },
    });
  }

  function deleteSource(source: SourceResponse): void {
    requestConfirm({
      title: "Delete source?",
      description: `This will delete ${source.name} and all notifications from this source.`,
      confirmLabel: "Delete source",
      danger: true,
      successMessage: "Source deleted.",
      action: async () => {
        await deleteSourceRequest(source.id);
        try {
          await refreshSources();
        } catch (refreshError) {
          toast.error(mutationErrorMessage(refreshError, "Source deleted, but the source list could not be refreshed."));
        }
      },
    });
  }

  return (
    <Page className="listen-stack">
      <Panel>
        {webhookUrl ? (
          <div className="listen-secret">
            <div className="listen-secret-copy">
              <div className="listen-secret-text">
                <strong>New webhook URL</strong>
                <code>{webhookUrl}</code>
              </div>
              <Button type="button" onClick={() => void copyWebhook(webhookUrl)}>Copy URL</Button>
            </div>
          </div>
        ) : null}
        <div className="listen-source-create">
          <TextField label="Source name" value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} error={error} />
          <Button type="button" variant="primary" disabled={busy} onClick={() => void create()}>{busy ? "Creating..." : "Create source"}</Button>
        </div>
      </Panel>
      {sources.length > 0 ? (
        <Panel>
          <DataList>
            {sources.map((source) => (
              <DataListRow
                key={source.id}
                title={source.name}
                description={source.lastUsedAt ? `Last used ${new Date(source.lastUsedAt).toLocaleString()}` : "Not used yet"}
                actions={(
                  <ActionMenu
                    ariaLabel={`Actions for ${source.name}`}
                    items={buildSourceActions({ source, onRotate: rotate, onDelete: deleteSource })}
                  />
                )}
              />
            ))}
          </DataList>
        </Panel>
      ) : null}
    </Page>
  );
}
