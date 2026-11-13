import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { today } from "../src/budget";
import { checkEndpoint } from "../src/check";
import { emptyCheckLog, type CheckLog } from "../src/log";
import { readMinBatch, statsEndpoint, statsFromLog, statsReply, STAT_NAMES, type StatCounts } from "../src/stats";
import { fakeNetwork, newVisitor, ORIGIN, post, providerMessage } from "./helpers";

const STATS_URL = "https://api.kyletebo.com/stats";
const allowed = { kind: "allowed", origin: ORIGIN } as const;

let counters = 0;
/** A fresh counter for each test, so one test's numbers never affect another's. */
function freshCounter() {
  counters += 1;
  return env.STATS.get(env.STATS.idFromName(`test-${Date.now()}-${counters}`));
}

/** A stand-in for the stats counter that records what it was asked to add. */
function fakeStats(options: { failRecord?: boolean; failRead?: boolean } = {}) {
  const recorded: Array<{ day: string; counts: StatCounts }> = [];
  const namespace = {
    idFromName: () => ({}),
    get: () => ({
      record: async (day: string, counts: StatCounts) => {
        if (options.failRecord) throw new Error("counter offline: a visitor's draft");
        recorded.push({ day, counts });
      },
      published: async () => {
        if (options.failRead) throw new Error("counter offline");
        return { since: null, through: null, totals: Object.fromEntries(STAT_NAMES.map((n) => [n, 0])) };
      },
    }),
  };
  return { namespace, recorded };
}

const getStats = (headers: Record<string, string> = {}, visitor = newVisitor()) =>
  new Request(STATS_URL, { headers: { origin: ORIGIN, "cf-connecting-ip": visitor, ...headers } });

afterEach(() => vi.restoreAllMocks());

describe("the stats counter", () => {
  const checks = (n: number): StatCounts => ({ checks_quick: n, quick_model_off: n });

  it("publishes nothing at first", async () => {
    const counter = freshCounter();
    const result = await counter.published("2026-11-20", 5);
    expect(result.since).toBeNull();
    expect(result.through).toBeNull();
    expect(Object.values(result.totals).every((value) => value === 0)).toBe(true);
  });

  it("never shows today's checks, however many there are", async () => {
    const counter = freshCounter();
    await counter.record("2026-11-20", checks(50));
    expect((await counter.published("2026-11-20", 5)).through).toBeNull();
    expect((await counter.published("2026-11-21", 5)).totals.checks_quick).toBe(50);
  });

  it("waits until a batch is big enough, then publishes it whole", async () => {
    const counter = freshCounter();
    await counter.record("2026-11-10", checks(3));
    expect((await counter.published("2026-11-12", 5)).through).toBeNull();

    await counter.record("2026-11-11", checks(2));
    const result = await counter.published("2026-11-12", 5);
    expect(result).toMatchObject({ since: "2026-11-10", through: "2026-11-11" });
    expect(result.totals.checks_quick).toBe(5);
  });

  it("holds back a small batch after a published one, so it cannot be picked out", async () => {
    const counter = freshCounter();
    await counter.record("2026-11-10", checks(6));
    expect((await counter.published("2026-11-11", 5)).totals.checks_quick).toBe(6);

    // One more check, on a later day. Comparing before and after must not reveal it.
    await counter.record("2026-11-11", { ...checks(1), model_calls: 1, cost_micros: 400 });
    const later = await counter.published("2026-11-15", 5);
    expect(later.through).toBe("2026-11-10");
    expect(later.totals).toMatchObject({ checks_quick: 6, cost_micros: 0 });
  });

  it("publishes in steps of at least the batch size", async () => {
    const counter = freshCounter();
    await counter.record("2026-11-10", checks(5));
    await counter.record("2026-11-11", checks(1));
    await counter.record("2026-11-12", checks(4));
    await counter.record("2026-11-13", checks(1));
    const result = await counter.published("2026-11-14", 5);
    // 5, then 1 + 4. The single check on the 13th waits.
    expect(result.through).toBe("2026-11-12");
    expect(result.totals.checks_quick).toBe(10);
  });

  it("includes guardrail counts from days with no checks once a later batch is published", async () => {
    const counter = freshCounter();
    await counter.record("2026-11-10", { guardrail_bot_check: 4 });
    expect((await counter.published("2026-11-11", 5)).through).toBeNull();
    await counter.record("2026-11-11", checks(5));
    expect((await counter.published("2026-11-12", 5)).totals).toMatchObject({ guardrail_bot_check: 4, checks_quick: 5 });
  });

  it("ignores names it does not know, numbers that are not whole and positive, and bad days", async () => {
    const counter = freshCounter();
    await counter.record("2026-11-10", {
      checks_full: 5,
      model_ms: -3,
      input_tokens: 1.5,
      ["draft_text" as never]: 7,
    } as StatCounts);
    await counter.record("not a day", checks(100));
    const result = await counter.published("2026-11-11", 5);
    expect(result.totals).toMatchObject({ checks_full: 5, checks_quick: 0, model_ms: 0, input_tokens: 0 });
    expect(Object.keys(result.totals).sort()).toEqual([...STAT_NAMES].sort());
  });
});

describe("what one check adds to the stats", () => {
  const base = { ...emptyCheckLog(), guardrail: null } as Omit<CheckLog, "status" | "durationMs">;

  it("counts a full check with what the model used", () => {
    expect(
      statsFromLog({ ...base, result: "full", modelStep: "ok", modelMs: 1234.4, inputTokens: 2400, outputTokens: 300, costMicros: 390 }),
    ).toEqual({ checks_full: 1, model_calls: 1, model_ms: 1234, input_tokens: 2400, output_tokens: 300, cost_micros: 390 });
  });

  it.each([
    ["switched_off", { quick_model_off: 1 }],
    ["budget_reached", { quick_daily_budget: 1, guardrail_daily_budget: 1 }],
    ["budget_unavailable", { quick_model_unavailable: 1, guardrail_daily_budget: 1 }],
    ["settings_broken", { quick_model_unavailable: 1 }],
  ] as const)("counts a quick check because of %s", (step, expected) => {
    const guardrail = step.startsWith("budget") ? "daily_budget" : null;
    expect(statsFromLog({ ...base, result: "quick", modelStep: step, guardrail })).toEqual({ checks_quick: 1, ...expected });
  });

  it("counts a quick check after a failed model call, including its cost", () => {
    expect(
      statsFromLog({ ...base, result: "quick", modelStep: "truncated", modelMs: 900, inputTokens: 10, outputTokens: 20, costMicros: 11 }),
    ).toEqual({ checks_quick: 1, quick_model_unavailable: 1, model_calls: 1, model_ms: 900, input_tokens: 10, output_tokens: 20, cost_micros: 11 });
  });

  it("counts the size cap and the bot check", () => {
    expect(statsFromLog({ ...base, result: "text_too_long", guardrail: "size_cap" })).toEqual({ guardrail_size_cap: 1 });
    expect(statsFromLog({ ...base, result: "bot_check_failed", guardrail: "bot_check" })).toEqual({ guardrail_bot_check: 1 });
  });

  it("does not count rate limit hits or malformed requests", () => {
    expect(statsFromLog({ ...base, result: "rate_limited", guardrail: "rate_limit" })).toBeNull();
    expect(statsFromLog({ ...base, result: "invalid_request" })).toBeNull();
  });
});

describe("the public reply", () => {
  it("gives totals and averages, and nulls where there is nothing to average", () => {
    const totals = Object.fromEntries(STAT_NAMES.map((n) => [n, 0])) as Record<(typeof STAT_NAMES)[number], number>;
    expect(statsReply({ since: null, through: null, totals })).toEqual({
      since: null,
      asOf: null,
      checks: { total: 0, full: 0, quick: 0 },
      quickBecause: { modelOff: 0, dailyBudget: 0, modelUnavailable: 0 },
      guardrails: { sizeCap: 0, botCheck: 0, dailyBudget: 0 },
      model: { calls: 0, inputTokens: 0, outputTokens: 0, averageSeconds: null },
      cost: { totalUsd: 0, perCheckUsd: null },
    });

    const busy = { ...totals, checks_full: 8, checks_quick: 2, model_calls: 8, model_ms: 20_000, cost_micros: 3_900 };
    expect(statsReply({ since: "2026-11-10", through: "2026-11-12", totals: busy })).toMatchObject({
      since: "2026-11-10",
      asOf: "2026-11-12",
      checks: { total: 10, full: 8, quick: 2 },
      model: { calls: 8, averageSeconds: 2.5 },
      cost: { totalUsd: 0.0039, perCheckUsd: 0.00039 },
    });
  });

  it("reads the batch size setting, refusing nonsense", () => {
    expect(readMinBatch("5")).toBe(5);
    for (const bad of ["", "0", "-1", "five", "2.5", "100000"]) expect(readMinBatch(bad)).toBeNull();
  });
});

describe("GET /stats", () => {
  it("answers kyletebo.com with the totals, which never include today", async () => {
    fakeNetwork();
    // A check today must not show up until tomorrow at the earliest.
    await exports.default.fetch(post({ text: "We post three lines on Mondays now." }));
    const response = await exports.default.fetch(getStats());
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["asOf", "checks", "cost", "guardrails", "model", "quickBecause", "since"]);
    expect(body.asOf === null || String(body.asOf) < today()).toBe(true);
  });

  it("refuses another website", async () => {
    const response = await exports.default.fetch(getStats({ origin: "https://example.com" }));
    expect(response.status).toBe(403);
  });

  it("accepts only GET, and says so to a preflight", async () => {
    expect((await exports.default.fetch(new Request(STATS_URL, { method: "POST", headers: { origin: ORIGIN } }))).status).toBe(405);
    const preflight = await exports.default.fetch(new Request(STATS_URL, { method: "OPTIONS", headers: { origin: ORIGIN } }));
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });

  it("allows 20 reads a minute from one visitor, then refuses with a wait time", async () => {
    const visitor = newVisitor();
    for (let i = 0; i < 20; i += 1) expect((await exports.default.fetch(getStats({}, visitor))).status).toBe(200);
    const refused = await exports.default.fetch(getStats({}, visitor));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
  });

  it("publishes nothing if the batch size setting is broken", async () => {
    const response = await statsEndpoint(getStats(), { ...env, STATS_MIN_BATCH: "0" }, allowed);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "stats_unavailable" });
  });

  it("says the stats are unavailable if the counter cannot be read, and logs a fixed line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { namespace } = fakeStats({ failRead: true });
    const response = await statsEndpoint(getStats(), { ...env, STATS: namespace } as unknown as Env, allowed);
    expect(response.status).toBe(503);
    expect(log.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual([
      { event: "failure", at: expect.any(String), failure: "stats_read_failed" },
    ]);
  });
});

describe("POST /check adds to the stats", () => {
  const on = { ...env, MODEL_ENABLED: "true" };
  const reply = providerMessage(JSON.stringify({ verdict: "clean", summary: "Reads naturally.", findings: [] }));

  it("adds a full check, with the model's numbers, to today", async () => {
    fakeNetwork({ model: reply });
    const { namespace, recorded } = fakeStats();
    await checkEndpoint(post({ text: "We post three lines on Mondays now." }), { ...on, STATS: namespace } as unknown as Env, allowed);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].day).toBe(today());
    expect(recorded[0].counts).toMatchObject({ checks_full: 1, model_calls: 1, input_tokens: 2400, output_tokens: 300, cost_micros: 390 });
  });

  it("adds nothing for a rate limit hit", async () => {
    fakeNetwork();
    const { namespace, recorded } = fakeStats();
    const visitor = newVisitor();
    const stubbed = { ...env, STATS: namespace } as unknown as Env;
    for (let i = 0; i < 6; i += 1) await checkEndpoint(post({ text: "A draft." }, {}, visitor), stubbed, allowed);
    // Five checks counted, the sixth refused and not counted.
    expect(recorded).toHaveLength(5);
  });

  it("still answers the visitor if the counter fails, and logs only a fixed line", async () => {
    fakeNetwork();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { namespace } = fakeStats({ failRecord: true });
    const response = await checkEndpoint(post({ text: "A draft." }), { ...env, STATS: namespace } as unknown as Env, allowed);
    expect(response.status).toBe(200);
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["check", "failure"]);
    expect(lines.join("\n")).not.toContain("draft");
  });
});
