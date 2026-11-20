import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackEndpoint, MAX_FEEDBACK_BYTES } from "../src/feedback";
import { logFeedback } from "../src/log";
import { notATellStat, statsReply, STAT_NAMES, type StatCounts } from "../src/stats";
import { TELL_TYPES } from "../src/tells";
import { fakeNetwork, newVisitor, ORIGIN } from "./helpers";

const FEEDBACK_URL = "https://api.kyletebo.com/feedback";
const allowed = { kind: "allowed", origin: ORIGIN } as const;

/** A POST to /feedback from the allowed website. */
function send(body: unknown, headers: Record<string, string> = {}, visitor: string = newVisitor()): Request {
  return new Request(FEEDBACK_URL, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": visitor, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = (type = "staccato") => ({ kind: "not_a_tell", type, botCheckToken: "token-from-the-page" });

/** A stand-in for the stats counter that records what it was asked to add. */
function fakeStats(options: { failRecord?: boolean } = {}) {
  const recorded: StatCounts[] = [];
  const namespace = {
    idFromName: () => ({}),
    get: () => ({
      record: async (counts: StatCounts) => {
        if (options.failRecord) throw new Error("counter offline");
        recorded.push(counts);
      },
    }),
  };
  return { namespace, recorded, env: { ...env, STATS: namespace } as unknown as Env };
}

afterEach(() => vi.restoreAllMocks());

describe("POST /feedback: a Not a tell is counted", () => {
  it("accepts a known type with a passing bot check, and adds one to that type", async () => {
    const { calls } = fakeNetwork();
    const stats = fakeStats();
    const response = await feedbackEndpoint(send(valid("tidy_closer")), stats.env, allowed);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(stats.recorded).toEqual([{ not_a_tell_tidy_closer: 1 }]);
    // The bot check is asked, without the visitor's address.
    expect(calls.botCheck).toHaveLength(1);
    expect(calls.botCheck[0].body).not.toContain("remoteip");
  });

  it("accepts every tell type, and each has its own stat", async () => {
    for (const type of TELL_TYPES) {
      fakeNetwork();
      const stats = fakeStats();
      const response = await feedbackEndpoint(send(valid(type)), stats.env, allowed);
      expect(response.status).toBe(200);
      expect(stats.recorded).toEqual([{ [`not_a_tell_${type}`]: 1 }]);
      expect(STAT_NAMES).toContain(notATellStat(type));
      vi.restoreAllMocks();
    }
  });

  it("answers at its address through the Worker, with the guest list's headers", async () => {
    fakeNetwork();
    const response = await exports.default.fetch(send(valid()));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("still answers if the counter is down, and notes it in the log", async () => {
    fakeNetwork();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await feedbackEndpoint(send(valid()), fakeStats({ failRecord: true }).env, allowed);
    expect(response.status).toBe(200);
    expect(log.mock.calls.map((call) => JSON.parse(call[0]).failure).filter(Boolean)).toEqual(["stats_write_failed"]);
  });

  it("sends the reply without waiting for the counter, when it can", async () => {
    fakeNetwork();
    let release = () => {};
    const stuck = new Promise<void>((resolve) => (release = resolve));
    const namespace = { idFromName: () => ({}), get: () => ({ record: () => stuck }) };
    const later: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => void later.push(promise) };
    const response = await feedbackEndpoint(send(valid()), { ...env, STATS: namespace } as unknown as Env, allowed, ctx);
    expect(response.status).toBe(200);
    expect(later).toHaveLength(1);
    release();
    await Promise.all(later);
  });
});

describe("POST /feedback: what it refuses", () => {
  it.each([
    ["a body that is not JSON", () => send("not a tell")],
    ["JSON sent as plain text", () => send(valid(), { "content-type": "text/plain" })],
    ["a list", () => send([valid()])],
    ["no kind", () => send({ type: "staccato", botCheckToken: "t" })],
    ["another kind of feedback", () => send({ ...valid(), kind: "great_tool" })],
    ["a type that does not exist", () => send(valid("made_up"))],
    ["a type that is not a string", () => send({ ...valid(), type: 3 })],
    // The draft's words must never be able to ride along.
    ["any extra field, such as the passage", () => send({ ...valid(), passage: "It's not about the code." })],
    ["a body over the size cap", () => send({ ...valid(), botCheckToken: "x".repeat(MAX_FEEDBACK_BYTES) })],
  ])("refuses %s, counts nothing and checks no bot token", async (_name, make) => {
    const { calls } = fakeNetwork();
    const stats = fakeStats();
    const response = await feedbackEndpoint(make(), stats.env, allowed);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(stats.recorded).toEqual([]);
    expect(calls.botCheck).toHaveLength(0);
  });

  it("refuses GET", async () => {
    const response = await exports.default.fetch(FEEDBACK_URL, { headers: { origin: ORIGIN } });
    expect(response.status).toBe(405);
  });

  it("refuses a page on another website before doing anything else", async () => {
    const { calls } = fakeNetwork();
    const response = await exports.default.fetch(send(valid(), { origin: "https://example.com" }));
    expect(response.status).toBe(403);
    expect(calls.botCheck).toHaveLength(0);
  });

  it("tells a browser's preflight that POST is allowed, and no other method", async () => {
    const response = await exports.default.fetch(FEEDBACK_URL, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "POST" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  });
});

describe("POST /feedback: guardrails", () => {
  it("refuses a failed bot check and counts nothing", async () => {
    fakeNetwork({ botCheck: { success: false } });
    const stats = fakeStats();
    const response = await feedbackEndpoint(send(valid()), stats.env, allowed);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "bot_check_failed" });
    expect(stats.recorded).toEqual([]);
  });

  it("refuses a token issued on another website", async () => {
    fakeNetwork({ botCheck: { success: true, hostname: "example.com", action: "check" } });
    const response = await feedbackEndpoint(send(valid()), fakeStats().env, allowed);
    expect(response.status).toBe(403);
  });

  it("refuses when the bot check secret has not been set", async () => {
    fakeNetwork();
    const response = await feedbackEndpoint(send(valid()), { ...fakeStats().env, TURNSTILE_SECRET_KEY: "" } as Env, allowed);
    expect(response.status).toBe(403);
  });

  it("allows 20 a minute from one visitor, then refuses with a wait time", async () => {
    fakeNetwork();
    const stats = fakeStats();
    const visitor = newVisitor();
    for (let i = 0; i < 20; i += 1) {
      expect((await feedbackEndpoint(send(valid(), {}, visitor), stats.env, allowed)).status).toBe(200);
    }
    const refused = await feedbackEndpoint(send(valid(), {}, visitor), stats.env, allowed);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(await refused.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 60 });
    expect(stats.recorded).toHaveLength(20);
  });

  it("refuses if the limiter itself is broken", async () => {
    const { calls } = fakeNetwork();
    const broken = { limit: async () => { throw new Error("limiter down"); } };
    const response = await feedbackEndpoint(send(valid()), { ...fakeStats().env, FEEDBACK_LIMITER: broken } as unknown as Env, allowed);
    expect(response.status).toBe(429);
    expect(calls.botCheck).toHaveLength(0);
  });
});

describe("POST /feedback: the log", () => {
  it("writes one line with only the result, status, type and time", async () => {
    fakeNetwork();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await feedbackEndpoint(send(valid("signpost")), fakeStats().env, allowed);
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0][0]);
    expect(Object.keys(line).sort()).toEqual(["at", "durationMs", "event", "result", "status", "type"]);
    expect(line).toMatchObject({ event: "feedback", result: "counted", status: 200, type: "signpost" });
  });

  it("logs a refused request without anything the visitor sent", async () => {
    fakeNetwork();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await feedbackEndpoint(send({ ...valid(), passage: "a secret sentence from the draft" }), fakeStats().env, allowed);
    const written = log.mock.calls.map((call) => call[0]).join("\n");
    expect(written).not.toContain("secret sentence");
    expect(written).not.toContain("token-from-the-page");
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ result: "invalid_request", status: 400, type: null });
  });

  it("writes only words from its fixed lists, whatever it is handed", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logFeedback({ result: "nonsense" as never, status: 200, type: "a passage of text" as never, durationMs: 5 });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ result: null, type: null });
  });
});

describe("Not a tell in the public stats", () => {
  it("reports a total and a count for every type", () => {
    const totals = Object.fromEntries(STAT_NAMES.map((n) => [n, 0])) as Record<(typeof STAT_NAMES)[number], number>;
    const reply = statsReply({
      since: "2026-11-20",
      through: "2026-11-20",
      totals: { ...totals, not_a_tell_staccato: 3, not_a_tell_other: 1 },
    });
    expect(reply.notATell.total).toBe(4);
    expect(Object.keys(reply.notATell.byType).sort()).toEqual([...TELL_TYPES].sort());
    expect(reply.notATell.byType.staccato).toBe(3);
  });
});
