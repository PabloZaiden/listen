import { jsonResponse } from "./helpers";

export function healthRoute(): Response {
  return jsonResponse({ ok: true });
}
