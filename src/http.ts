/**
 * Shared pieces for building replies.
 */

import { corsHeaders, type OriginCheck } from "./cors";

/**
 * Headers sent on every reply, whatever the outcome.
 */
export const BASE_HEADERS: Record<string, string> = {
  // Replies are small and change over time, so browsers should not keep copies.
  "cache-control": "no-store",
  // Tells browsers to trust the stated content type and never guess another.
  "x-content-type-options": "nosniff",
  // Tells browsers to use HTTPS for this address for the next 180 days, even
  // if a link says http. Covers api.kyletebo.com only, not the whole domain.
  "strict-transport-security": "max-age=15552000",
};

/** Builds a JSON reply. Every endpoint answers in JSON so the site's scripts
 * can always read the response the same way. */
export function json(body: unknown, status: number, origin: OriginCheck): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

type Handler = (request: Request, env: Env) => Promise<Response>;

/**
 * The safety net. If anything inside the Worker fails unexpectedly, the
 * visitor gets a plain "internal_error" and the log gets one fixed line.
 *
 * The error itself is deliberately thrown away. Error messages can contain
 * whatever the code was handling at the time, including a visitor's text, and
 * Cloudflare stores uncaught errors automatically. Catching everything here
 * is what keeps the privacy rule true.
 */
export function withErrorHandling(handler: Handler): Handler {
  return async (request, env) => {
    try {
      return await handler(request, env);
    } catch {
      console.error(JSON.stringify({ event: "unhandled_error" }));
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: {
          ...BASE_HEADERS,
          "content-type": "application/json; charset=utf-8",
          vary: "Origin",
        },
      });
    }
  };
}
