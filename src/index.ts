/**
 * The Workbench Worker: the "bouncer" between kyletebo.com and the model.
 *
 * Phase 0 only proves the plumbing. There is one endpoint, GET /hello, and it
 * returns a fixed reply. No model is called and no secret is read yet.
 */

/** Builds a JSON reply. Every endpoint answers in JSON so the site's scripts
 * can always read the response the same way. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Replies are small and change over time, so browsers should not keep copies.
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/hello") {
      if (request.method !== "GET") {
        return json({ error: "method_not_allowed" }, 405);
      }
      return json({
        ok: true,
        message: "Hello from the Workbench. The plumbing works.",
        phase: 0,
      });
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
