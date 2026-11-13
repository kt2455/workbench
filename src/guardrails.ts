/**
 * The checks a request passes before any work is done for it: the size cap,
 * the per-visitor rate limit and the bot check. The fourth guardrail, the
 * daily budget, is in src/budget.ts.
 *
 * Nothing in this file writes to a log or to storage.
 */

/** The outcome of reading a request body with a size cap. */
export type BodyRead = { ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid" };

/**
 * Reads a JSON body, stopping as soon as it grows past `maxBytes`.
 *
 * The size is counted as the data arrives. A sender can claim any size in a
 * header, so the claim is used only to refuse early, never to let more in.
 */
export async function readJsonCapped(request: Request, maxBytes: number): Promise<BodyRead> {
  const claimed = Number(request.headers.get("content-length"));
  if (Number.isFinite(claimed) && claimed > maxBytes) return { ok: false, reason: "too_large" };
  if (request.body === null) return { ok: false, reason: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // "fatal" refuses bytes that are not valid text instead of guessing.
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** The window the rate limit counts over, in seconds. Set in wrangler.jsonc. */
export const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * The key a visitor is counted under: their IPv4 address, or for IPv6 the
 * first half of the address (the /64 network). One IPv6 connection usually
 * comes with a whole /64 of addresses, billions of them, so counting each
 * address separately would let one person dodge the limit by switching.
 */
export function rateLimitKey(address: string | null): string {
  if (address === null || address === "") return "unknown";
  if (!address.includes(":")) return address;
  const [head, tail = ""] = address.toLowerCase().split("::");
  const front = head === "" ? [] : head.split(":");
  const back = tail === "" ? [] : tail.split(":");
  const missing = 8 - front.length - back.length;
  const groups = address.includes("::") ? [...front, ...Array(Math.max(missing, 0)).fill("0"), ...back] : front;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * True when this visitor is within the rate limit.
 *
 * Visitors are told apart by IP address (see rateLimitKey). The key is handed
 * to Cloudflare's rate limiter, which keeps a short-lived count in memory.
 * This code does not store it, log it or pass it anywhere else.
 *
 * Cloudflare's limiter is approximate and counts separately in each of its
 * locations, so this is a speed bump, not a wall. The bot check and the daily
 * budget are what stop real spending.
 *
 * If the limiter itself fails, the request is refused: a broken guardrail
 * must not become an open door.
 */
export async function withinRateLimit(request: Request, limiter: RateLimit): Promise<boolean> {
  const visitor = rateLimitKey(request.headers.get("cf-connecting-ip"));
  try {
    const { success } = await limiter.limit({ key: visitor });
    return success;
  } catch {
    return false;
  }
}

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's stated maximum length for a bot check token. */
const MAX_TOKEN_CHARS = 2048;
/** The label the page gives its bot check. A token made for anything else is refused. */
export const BOT_CHECK_ACTION = "check";

/**
 * Asks Cloudflare Turnstile whether a bot check token is genuine.
 *
 * The page gets a token when a visitor passes the check. Anyone can type any
 * string into the request, so a token proves nothing until Cloudflare
 * confirms it. A token works once and for five minutes.
 *
 * The visitor's IP address is deliberately not sent: it is optional, and the
 * rule here is that the address goes nowhere it does not have to.
 *
 * Any failure, including Cloudflare not answering, counts as not verified.
 */
export async function passedBotCheck(
  token: unknown,
  secret: string | undefined,
  allowedOrigin: string,
): Promise<boolean> {
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_CHARS) return false;
  if (typeof secret !== "string" || secret === "") return false;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown; hostname?: unknown; action?: unknown };
    // The token must have been issued on the website itself, for this purpose.
    return (
      result.success === true &&
      result.hostname === new URL(allowedOrigin).hostname &&
      result.action === BOT_CHECK_ACTION
    );
  } catch {
    return false;
  }
}
