/**
 * CORS: the guest list for which websites may call this Worker from a browser.
 *
 * Browsers attach an "Origin" header saying which website a page's script came
 * from. The Worker compares it with the one allowed website and refuses the
 * rest.
 *
 * This stops other websites. It does not stop scripts or command-line tools,
 * which send no Origin header at all (or can invent one). It is one layer of
 * several: rate limits, the daily budget and the bot check cover the rest.
 */

const ALLOWED_HEADERS = "content-type";
/** How long a browser may remember the answer to a preflight check: one day. */
const PREFLIGHT_MAX_AGE_SECONDS = "86400";

export type OriginCheck =
  /** No Origin header: not a cross-site browser call. Allowed, no CORS headers. */
  | { kind: "none" }
  /** The Origin is the allowed website. */
  | { kind: "allowed"; origin: string }
  /** The Origin is some other website. */
  | { kind: "refused" };

export function checkOrigin(request: Request, allowedOrigin: string): OriginCheck {
  const origin = request.headers.get("origin");
  if (origin === null) return { kind: "none" };
  // An exact match only. No wildcards and no "ends with" checks, which are the
  // classic way to let in look-alike addresses such as kyletebo.com.evil.example.
  if (origin === allowedOrigin) return { kind: "allowed", origin };
  return { kind: "refused" };
}

/** The headers that tell a browser the allowed website may read the reply. */
export function corsHeaders(check: OriginCheck): Record<string, string> {
  // "Vary: Origin" tells caches the reply depends on who asked, so a reply
  // meant for one website is never handed to another.
  const headers: Record<string, string> = { vary: "Origin" };
  if (check.kind === "allowed") {
    headers["access-control-allow-origin"] = check.origin;
  }
  return headers;
}

/**
 * The extra headers for a "preflight": the question a browser asks, as an
 * OPTIONS request, before sending anything more than a simple GET. The answer
 * lists only the methods the endpoint really accepts.
 */
export function preflightHeaders(check: OriginCheck, methods: readonly string[]): Record<string, string> {
  return {
    ...corsHeaders(check),
    "access-control-allow-methods": [...methods, "OPTIONS"].join(", "),
    "access-control-allow-headers": ALLOWED_HEADERS,
    "access-control-max-age": PREFLIGHT_MAX_AGE_SECONDS,
  };
}
