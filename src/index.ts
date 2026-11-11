/**
 * The Workbench Worker: the "bouncer" between kyletebo.com and the model.
 *
 * Phase 0 only proves the plumbing. There is one endpoint, GET /hello, and it
 * returns a fixed reply. No model is called and no secret is read yet.
 */

import { checkOrigin, corsHeaders, preflightResponse, type OriginCheck } from "./cors";

/** Builds a JSON reply. Every endpoint answers in JSON so the site's scripts
 * can always read the response the same way. */
function json(body: unknown, status: number, origin: OriginCheck): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Replies are small and change over time, so browsers should not keep copies.
      "cache-control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    // The guest list comes first, before any endpoint runs.
    const origin = checkOrigin(request, env.ALLOWED_ORIGIN);
    if (origin.kind === "refused") {
      return json({ error: "origin_not_allowed" }, 403, origin);
    }
    if (request.method === "OPTIONS") {
      return preflightResponse(origin);
    }

    const url = new URL(request.url);

    if (url.pathname === "/hello") {
      if (request.method !== "GET") {
        return json({ error: "method_not_allowed" }, 405, origin);
      }
      return json(
        {
          ok: true,
          message: "Hello from the Workbench. The plumbing works.",
          phase: 0,
        },
        200,
        origin,
      );
    }

    return json({ error: "not_found" }, 404, origin);
  },
} satisfies ExportedHandler<Env>;
