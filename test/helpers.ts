import { vi } from "vitest";

export const ORIGIN = "https://kyletebo.com";
export const CHECK_URL = "https://api.kyletebo.com/check";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const PROVIDER = "https://api.anthropic.com/v1/messages";

let visitors = 0;
/** A new made-up visitor address, so one test's rate limit never affects another's. */
export function newVisitor(): string {
  visitors += 1;
  return `203.0.113.${visitors % 250}:${Date.now()}:${visitors}`;
}

/** Builds a POST to /check from the allowed website, with a bot check token. */
export function post(
  body: unknown,
  headers: Record<string, string> = {},
  visitor: string = newVisitor(),
): Request {
  const fields =
    typeof body === "object" && body !== null && !Array.isArray(body) ? { botCheckToken: "token-from-the-page", ...body } : body;
  return new Request(CHECK_URL, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": visitor, ...headers },
    body: typeof fields === "string" ? fields : JSON.stringify(fields),
  });
}

const jsonReply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const BOT_CHECK_PASS = { success: true, hostname: "kyletebo.com", action: "check" };

/** What a provider's successful reply looks like on the wire. */
export const providerMessage = (text: string, stop_reason = "end_turn") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "test-model",
  content: [{ type: "text", text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 2400, output_tokens: 300 },
});

export interface Recorded {
  headers: Headers;
  body: string;
}

/**
 * Replaces the network for one test. Nothing real is ever contacted: the bot
 * check and the model provider both get canned replies, and any other
 * address fails the test.
 */
export function fakeNetwork(options: { botCheck?: unknown; botCheckStatus?: number; model?: unknown; modelStatus?: number } = {}) {
  // Each outside call is recorded as plain values, read at the moment it is made.
  const calls = { botCheck: [] as Recorded[], model: [] as Recorded[] };
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const recorded: Recorded = { headers: new Headers(request.headers), body: await request.text() };
    if (request.url === SITEVERIFY) {
      calls.botCheck.push(recorded);
      return jsonReply(options.botCheck ?? BOT_CHECK_PASS, options.botCheckStatus);
    }
    if (request.url === PROVIDER) {
      calls.model.push(recorded);
      if (options.model === undefined) throw new Error("the test did not expect a model call");
      return jsonReply(options.model, options.modelStatus);
    }
    throw new Error(`unexpected outside call to ${request.url}`);
  });
  return { calls, spy };
}
