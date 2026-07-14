import type { WebAppPublicAssetOptions } from "@pablozaiden/webapp/server";

export const SERVICE_WORKER_ASSET = {
  path: "/service-worker",
  entrypoint: new URL("./service-worker.ts", import.meta.url),
  contentType: "text/javascript; charset=utf-8",
  headers: {
    "service-worker-allowed": "/",
    "cache-control": "no-cache",
  },
  format: "iife",
} satisfies WebAppPublicAssetOptions;
