/**
 * POST /feedback: a visitor's "Not a tell" on one of the Tells Checker's
 * findings.
 *
 * The page sends three things: the kind of feedback (only "not_a_tell"
 * exists), the finding's type (one of the fixed tell types) and a fresh bot
 * check token. Nothing else is accepted, so no text from the draft can reach
 * the Worker this way, even by mistake. The count goes into the public stats
 * (src/stats.ts) as one more "not a tell" for that type.
 *
 * Guardrails, in order: the guest list (src/index.ts), JSON only, a rate limit
 * of its own, a size cap, then the bot check. Every one fails closed. No model
 * is called, so there is nothing to spend.
 */

import type { OriginCheck } from "./cors";
import { passedBotCheck, readJsonCapped, RATE_LIMIT_WINDOW_SECONDS, withinRateLimit } from "./guardrails";
import { json } from "./http";
import { logFeedback, type FeedbackResult } from "./log";
import { recordNotATell } from "./stats";
import { TELL_TYPES, type TellType } from "./tells";

/** The largest body accepted. A real one is about 1 KB, almost all of it the token. */
export const MAX_FEEDBACK_BYTES = 4096;

/** The only fields a feedback body may have. */
const FIELDS = ["kind", "type", "botCheckToken"];

function isTellType(value: unknown): value is TellType {
  return typeof value === "string" && (TELL_TYPES as readonly string[]).includes(value);
}

/** A reply, plus what the log line should say about it. */
interface Handled {
  response: Response;
  result: FeedbackResult;
  type: TellType | null;
}

/**
 * POST /feedback. Handles the request, writes its one log line and, when it
 * was accepted, adds it to the public stats.
 */
export async function feedbackEndpoint(
  request: Request,
  env: Env,
  origin: OriginCheck,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  const started = Date.now();
  const { response, result, type } = await handleFeedback(request, env, origin);
  logFeedback({ result, status: response.status, type, durationMs: Date.now() - started });
  if (result === "counted" && type !== null) {
    // As with checks, the counter never fails or slows the request.
    const recording = recordNotATell(env.STATS, type);
    if (ctx) ctx.waitUntil(recording);
    else await recording;
  }
  return response;
}

async function handleFeedback(request: Request, env: Env, origin: OriginCheck): Promise<Handled> {
  const refuse = (
    error: "invalid_request" | "rate_limited" | "bot_check_failed",
    status: number,
    type: TellType | null = null,
    headers?: Record<string, string>,
  ): Handled => ({
    response: json(
      error === "rate_limited" ? { error, retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS } : { error },
      status,
      origin,
      headers,
    ),
    result: error,
    type,
  });

  // 1. Only JSON, so a page on another website has to ask the browser first,
  // and the guest list refuses it.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return refuse("invalid_request", 400);

  // 2. Its own rate limit, before any effort.
  if (!(await withinRateLimit(request, env.FEEDBACK_LIMITER))) {
    return refuse("rate_limited", 429, null, { "retry-after": String(RATE_LIMIT_WINDOW_SECONDS) });
  }

  // 3. A small size cap, enforced while reading, then the exact shape.
  const read = await readJsonCapped(request, MAX_FEEDBACK_BYTES);
  if (!read.ok) return refuse("invalid_request", 400);
  const body = read.value;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return refuse("invalid_request", 400);
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !FIELDS.includes(key))) return refuse("invalid_request", 400);
  if (fields.kind !== "not_a_tell" || !isTellType(fields.type)) return refuse("invalid_request", 400);
  const type = fields.type;

  // 4. The bot check, as for every check.
  if (!(await passedBotCheck(fields.botCheckToken, env.TURNSTILE_SECRET_KEY, env.ALLOWED_ORIGIN))) {
    return refuse("bot_check_failed", 403, type);
  }

  return { response: json({ ok: true }, 200, origin), result: "counted", type };
}
