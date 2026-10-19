import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Button,
  EmptyState,
  ErrorState,
  FormActions,
  LoadingState,
  Page,
  Panel,
  replaceWebAppRoute,
  type WebAppRoute,
} from "@pablozaiden/webapp/web";
import type { NotificationActions, NotificationLoader } from "../hooks/use-notifications";
import { sourceFilterRoute } from "./route-utils";

function normalizeMarkdownForDisplay(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

export type NotificationViewProps = {
  route: WebAppRoute;
  notificationLoader: NotificationLoader;
};

export function NotificationView({ route, notificationLoader }: NotificationViewProps) {
  const id = typeof route.id === "string" ? route.id : "";
  const returnSourceId = typeof route.sourceId === "string" ? route.sourceId : undefined;
  const returnRoute = sourceFilterRoute(returnSourceId);
  const { result, actions: notificationActions, error: collectionError, retry } = notificationLoader;
  const ownerReady = result !== undefined && result.sourceId === returnSourceId;
  const [detail, setDetail] = useState<Awaited<ReturnType<NotificationActions["getDetail"]>>>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    const notification = await notificationActions.getDetail(id, signal);
    if (signal?.aborted) return;
    setDetail(notification);
    setError(undefined);
  }, [id, notificationActions]);

  useEffect(() => {
    setDetail(undefined);
    setError(undefined);
    if (!ownerReady) return;
    const controller = new AbortController();
    void refresh(controller.signal).catch((requestError) => {
      if (!controller.signal.aborted) {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    });
    return () => controller.abort();
  }, [ownerReady, refresh]);

  if (!ownerReady) {
    return (
      <Page>
        {collectionError ? (
          <ErrorState
            title="Could not load notifications"
            description={collectionError.message}
            action={<Button type="button" onClick={() => { void retry(); }}>Retry</Button>}
          />
        ) : <Panel><LoadingState title="Loading notification..." /></Panel>}
      </Page>
    );
  }

  if (error) {
    return <Page><EmptyState title="Notification not found" description={error} /></Page>;
  }
  if (!detail) {
    return <Page><Panel><EmptyState title="Loading notification..." /></Panel></Page>;
  }

  return (
    <Page className="listen-stack">
      <Panel>
        <div className="listen-detail-summary">
          {detail.icon ? <img className="listen-detail-icon" src={detail.icon} alt="" /> : null}
          <div>
            <h2>{detail.title}</h2>
            <p>{detail.shortDescription}</p>
          </div>
        </div>
        <div className="listen-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => {
              try {
                const parsed = new URL(url, window.location.href);
                return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? url : "";
              } catch {
                return "";
              }
            }}
            components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" /> }}
          >
            {normalizeMarkdownForDisplay(detail.markdownContent)}
          </ReactMarkdown>
        </div>
      </Panel>
      <FormActions>
        <Button type="button" onClick={() => replaceWebAppRoute(returnRoute)}>Back</Button>
      </FormActions>
    </Page>
  );
}
