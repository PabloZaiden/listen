import { appWebSocketUrl } from "@listen/client-sdk";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "connecting" | "open" | "closed";

export function useWebSocket(path: string | undefined): { status: Status; lastEvent?: { type: string; [key: string]: unknown } } {
  const [status, setStatus] = useState<Status>("idle");
  const [lastEvent, setLastEvent] = useState<{ type: string; [key: string]: unknown }>();
  const reconnectAttempt = useRef(0);

  useEffect(() => {
    if (!path) {
      setStatus("idle");
      return;
    }

    let socket: WebSocket | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = (): void => {
      setStatus("connecting");
      socket = new WebSocket(appWebSocketUrl(path));
      socket.addEventListener("open", () => {
        reconnectAttempt.current = 0;
        setStatus("open");
      });
      socket.addEventListener("message", (event) => {
        try {
          setLastEvent(JSON.parse(event.data as string) as { type: string; [key: string]: unknown });
        } catch {
          // Ignore malformed realtime frames.
        }
      });
      socket.addEventListener("close", () => {
        if (stopped) {
          return;
        }
        setStatus("closed");
        const delay = Math.min(30_000, 500 * 2 ** reconnectAttempt.current);
        reconnectAttempt.current += 1;
        timer = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      socket?.close();
    };
  }, [path]);

  return { status, lastEvent };
}
