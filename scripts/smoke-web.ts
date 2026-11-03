const baseUrl = process.env["LISTEN_BASE_URL"] ?? "http://localhost:3018";

async function response(path: string, contentType?: string): Promise<Response> {
  const result = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(5000) });
  if (!result.ok || (contentType && !result.headers.get("content-type")?.includes(contentType))) {
    throw new Error(`Web smoke failed for ${path} (${result.status})`);
  }
  return result;
}

const deadline = Date.now() + 10_000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    healthy = (await fetch(new URL("/api/health", baseUrl), { signal: AbortSignal.timeout(1000) })).ok;
    if (healthy) break;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  await Bun.sleep(50);
}
if (!healthy) throw new Error("Listen did not become healthy");
const html = await (await response("/", "text/html")).text();
const scripts = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (match) => match[1]!);
const styles = Array.from(html.matchAll(/<link[^>]+href="([^"]+\.css)"/g), (match) => match[1]!);
if (!scripts.length || !styles.length) throw new Error("Listen did not serve embedded web assets");
for (const path of scripts) await response(path, "javascript");
for (const path of styles) await response(path, "text/css");
await response("/site.webmanifest", "application/manifest+json");
await response("/webapp-favicon.svg", "image/svg+xml");
await response("/webapp-icon-1.png", "image/png");
await response("/webapp-apple-touch-icon.png", "image/png");
const worker = await response("/service-worker", "javascript");
if (worker.headers.get("service-worker-allowed") !== "/" || worker.headers.get("cache-control") !== "no-cache") {
  throw new Error("Service worker scope/cache headers are invalid");
}
if ((await fetch(new URL("/api/sources", baseUrl))).status !== 401) throw new Error("Private app access is not gated");
console.log("Listen web health/assets/PWA/private-access smoke passed");
