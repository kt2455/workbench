/**
 * The Workbench Worker: the "bouncer" between kyletebo.com and the model.
 *
 * It answers two addresses, listed in ROUTES below: GET /hello, a fixed reply
 * that proves the Worker is up, and POST /check, the Tells Checker
 * (src/check.ts). Every request first passes the guest list (src/cors.ts).
 */

import { checkEndpoint } from "./check";
import { checkOrigin, preflightHeaders, type OriginCheck } from "./cors";
import { BASE_HEADERS, json, withErrorHandling } from "./http";
import { logRefused } from "./log";

type Endpoint = (request: Request, env: Env, origin: OriginCheck) => Response | Promise<Response>;

/**
 * Every address the Worker answers, and the methods each one accepts.
 * Anything not listed here does not exist.
 */
const ROUTES: Record<string, Record<string, Endpoint>> = {
  "/hello": {
    GET: (_request, _env, origin) =>
      json(
        {
          ok: true,
          message: "Hello from the Workbench. The plumbing works.",
          phase: 0,
        },
        200,
        origin,
      ),
  },
  "/check": { POST: checkEndpoint },
};

async function handle(request: Request, env: Env): Promise<Response> {
  // The guest list comes first, before any endpoint runs.
  const origin = checkOrigin(request, env.ALLOWED_ORIGIN);
  if (origin.kind === "refused") {
    logRefused("origin", 403);
    return json({ error: "origin_not_allowed" }, 403, origin);
  }

  const url = new URL(request.url);
  const route = Object.hasOwn(ROUTES, url.pathname) ? ROUTES[url.pathname] : undefined;
  if (route === undefined) {
    return json({ error: "not_found" }, 404, origin);
  }

  const methods = Object.keys(route);

  // A browser's preflight question, answered only for addresses that exist.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...BASE_HEADERS, ...preflightHeaders(origin, methods) },
    });
  }

  // HEAD means "send me the headers of a GET, without the body". Uptime
  // checkers use it.
  const method = request.method === "HEAD" ? "GET" : request.method;
  const endpoint = Object.hasOwn(route, method) ? route[method] : undefined;
  if (endpoint === undefined) {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  const response = await endpoint(request, env, origin);
  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}

export default {
  fetch: withErrorHandling(handle),
} satisfies ExportedHandler<Env>;

// The daily budget counter. Cloudflare needs it exported from this file.
export { BudgetKeeper } from "./budget";
