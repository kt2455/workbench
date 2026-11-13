import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { today } from "../src/budget";
import { checkEndpoint } from "../src/check";
import { emptyCheckLog, type CheckLog } from "../src/log";
import { nextDay, readMinBatch, statsEndpoint, statsFromLog, statsReply, STAT_NAMES, type StatCounts } from "../src/stats";
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
  const recorded: StatCounts[] = [];
  const namespace = {
    idFromName: () => ({}),
    get: () => ({
      record: async (counts: StatCounts) => {
        if (options.failRecord) throw new Error("counter offline: a visitor's draft");
        recorded.push(counts);
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
  const fullChecks = (n: number, costEach = 400): StatCounts => ({
    checks_full: n,
    model_calls: n,
    model_ms: n * 2000,
    cost_micros: n * costEach,
  });

  it("publishes nothing at first", async () => {
    const counter = freshCounter();
    const result = await counter.published(5, "2026-11-20");
    expect(result.since).toBeNull();
    expect(result.through).toBeNull();
    expect(Object.values(result.totals).every((value) => value === 0)).toBe(true);
  });

  it("files a check under today by its own clock, and never shows today", async () => {
    const counter = freshCounter();
    for (let i = 0; i < 6; i += 1) await counter.record(checks(1));
    expect((await counter.published(5)).through).toBeNull();
    const tomorrow = nextDay(today());
    expect(await counter.published(5, tomorrow)).toMatchObject({ through: today() });
  });

  it("never shows a day until it is over, however many checks it has", async () => {
    const counter = freshCounter();
    await counter.record(checks(50), "2026-11-20");
    expect((await counter.published(5, "2026-11-20")).through).toBeNull();
    expect((await counter.published(5, "2026-11-21")).totals.checks_quick).toBe(50);
  });

  it("waits until a batch is big enough, then publishes it whole", async () => {
    const counter = freshCounter();
    await counter.record(checks(3), "2026-11-10");
    expect((await counter.published(5, "2026-11-12")).through).toBeNull();

    await counter.record(checks(2), "2026-11-11");
    const result = await counter.published(5, "2026-11-12");
    expect(result).toMatchObject({ since: "2026-11-10", through: "2026-11-11" });
    expect(result.totals.checks_quick).toBe(5);
  });

  it("holds back a small batch after a published one, so it cannot be picked out", async () => {
    const counter = freshCounter();
    await counter.record(checks(6), "2026-11-10");
    expect((await counter.published(5, "2026-11-11")).totals.checks_quick).toBe(6);

    await counter.record(fullChecks(1), "2026-11-11");
    const later = await counter.published(5, "2026-11-15");
    expect(later.through).toBe("2026-11-10");
    expect(later.totals).toMatchObject({ checks_quick: 6, checks_full: 0, cost_micros: 0 });
  });

  it("holds back a batch with only a few model calls, even with enough checks", async () => {
    const counter = freshCounter();
    // Four free quick checks and one full check: publishing would show that
    // one full check's cost and time on its own.
    await counter.record(checks(4), "2026-11-10");
    await counter.record(fullChecks(1), "2026-11-10");
    expect((await counter.published(5, "2026-11-11")).through).toBeNull();

    await counter.record(fullChecks(4), "2026-11-11");
    expect(await counter.published(5, "2026-11-12")).toMatchObject({
      through: "2026-11-11",
      totals: { checks_quick: 4, checks_full: 5, model_calls: 5 },
    });
  });

  it("publishes in steps of at least the batch size", async () => {
    const counter = freshCounter();
    await counter.record(checks(5), "2026-11-10");
    await counter.record(checks(1), "2026-11-11");
    await counter.record(checks(4), "2026-11-12");
    await counter.record(checks(1), "2026-11-13");
    const result = await counter.published(5, "2026-11-14");
    // 5, then 1 + 4. The single check on the 13th waits.
    expect(result.through).toBe("2026-11-12");
    expect(result.totals.checks_quick).toBe(10);
  });

  it("never changes a day that is already published: a late check moves to the next day", async () => {
    const counter = freshCounter();
    await counter.record(checks(5), "2026-11-10");
    const before = await counter.published(5, "2026-11-11");
    expect(before.through).toBe("2026-11-10");

    // A check stamped just before midnight that arrives after the day was published.
    await counter.record(checks(1), "2026-11-10");
    const after = await counter.published(5, "2026-11-11");
    expect(after.totals).toEqual(before.totals);

    await counter.record(checks(4), "2026-11-11");
    expect(await counter.published(5, "2026-11-12")).toMatchObject({ through: "2026-11-11", totals: { checks_quick: 10 } });
  });

  it("includes guardrail counts from days with no checks once a later batch is published", async () => {
    const counter = freshCounter();
    await counter.record({ guardrail_bot_check: 4 }, "2026-11-10");
    expect((await counter.published(5, "2026-11-11")).through).toBeNull();
    await counter.record(checks(5), "2026-11-11");
    expect((await counter.published(5, "2026-11-12")).totals).toMatchObject({ guardrail_bot_check: 4, checks_quick: 5 });
  });

  it("ignores names it does not know, numbers that are not whole and positive, and bad days", async () => {
    const counter = freshCounter();
    await counter.record(
      { checks_full: 5, model_ms: -3, input_tokens: 1.5, ["draft_text" as never]: 7 } as StatCounts,
      "2026-11-10",
    );
    await counter.record(checks(100), "not a day");
    const result = await counter.published(5, "2026-11-11");
    expect(result.totals).toMatchObject({ checks_full: 5, checks_quick: 0, model_ms: 0, input_tokens: 0 });
    expect(Object.keys(result.totals).sort()).toEqual([...STAT_NAMES].sort());
  });

  it("works out the next day across month and year ends", () => {
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
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

  it.each(["refused", "truncated", "unreadable_reply"] as const)("counts a charged call that ended %s", (step) => {
    expect(
      statsFromLog({ ...base, result: "quick", modelStep: step, modelMs: 900, inputTokens: 10, outputTokens: 20, costMicros: 11 }),
    ).toMatchObject({ checks_quick: 1, quick_model_unavailable: 1, model_calls: 1, cost_micros: 11 });
  });

  it("counts a call that never reached the provider: its time, and no cost", () => {
    expect(
      statsFromLog({ ...base, result: "quick", modelStep: "unavailable", modelMs: 25_000, inputTokens: null, outputTokens: null, costMicros: 0 }),
    ).toEqual({ checks_quick: 1, quick_model_unavailable: 1, model_calls: 1, model_ms: 25_000, input_tokens: 0, output_tokens: 0, cost_micros: 0 });
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
      model: { calls: 0, averageSeconds: null },
      cost: { totalUsd: 0, perModelCallUsd: null },
    });

    const busy = { ...totals, checks_full: 8, checks_quick: 2, model_calls: 8, model_ms: 20_123, cost_micros: 3_900, input_tokens: 19_200 };
    const reply = statsReply({ since: "2026-11-10", through: "2026-11-12", totals: busy });
    expect(reply).toMatchObject({
      since: "2026-11-10",
      asOf: "2026-11-12",
      checks: { total: 10, full: 8, quick: 2 },
      // Rounded to a tenth of a second.
      model: { calls: 8, averageSeconds: 2.5 },
      // The total to the cent; per model call, not per check, to $0.0001.
      cost: { totalUsd: 0, perModelCallUsd: 0.0005 },
    });
    // Token counts are kept but never published.
    expect(JSON.stringify(reply)).not.toContain("19200");
    expect(JSON.stringify(reply)).not.toMatch(/token/i);
  });

  it("does not let someone who sent four of five checks work out the fifth one's cost", () => {
    const totals = Object.fromEntries(STAT_NAMES.map((n) => [n, 0])) as Record<(typeof STAT_NAMES)[number], number>;
    // Four known checks at 300 micro-dollars, and a fifth at either 350 or 520.
    const cheap = statsReply({ since: "d", through: "d", totals: { ...totals, checks_full: 5, model_calls: 5, cost_micros: 1200 + 350 } });
    const dear = statsReply({ since: "d", through: "d", totals: { ...totals, checks_full: 5, model_calls: 5, cost_micros: 1200 + 520 } });
    expect(cheap.cost).toEqual(dear.cost);
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
    expect(await refused.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 60 });
  });

  it("logs a stats rate limit hit as a fixed line, without the visitor", async () => {
    const visitor = newVisitor();
    for (let i = 0; i < 20; i += 1) await exports.default.fetch(getStats({}, visitor));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await exports.default.fetch(getStats({}, visitor));
    expect(log.mock.calls.map((call) => String(call[0]))).toHaveLength(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).not.toContain(visitor);
    expect(JSON.parse(line)).toEqual({ event: "refused", at: expect.any(String), guardrail: "rate_limit", status: 429, endpoint: "stats" });
  });

  it("answers HEAD with the headers and no body", async () => {
    const response = await exports.default.fetch(new Request(STATS_URL, { method: "HEAD", headers: { origin: ORIGIN, "cf-connecting-ip": newVisitor() } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe("");
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
    expect(recorded[0]).toMatchObject({ checks_full: 1, model_calls: 1, input_tokens: 2400, output_tokens: 300, cost_micros: 390 });
  });

  it("counts the daily budget guardrail as the endpoint really reports it", async () => {
    fakeNetwork({ model: reply });
    const { namespace, recorded } = fakeStats();
    const spent = { ...on, DAILY_BUDGET_USD: "0.000001", STATS: namespace } as unknown as Env;
    await checkEndpoint(post({ text: "A draft." }), spent, allowed);
    expect(recorded).toEqual([{ checks_quick: 1, quick_daily_budget: 1, guardrail_daily_budget: 1 }]);
  });

  it("sends the reply without waiting for the counter, when it can", async () => {
    fakeNetwork();
    let release = () => {};
    const stuck = new Promise<void>((resolve) => (release = resolve));
    const namespace = { idFromName: () => ({}), get: () => ({ record: () => stuck }) };
    const later: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => void later.push(promise) };
    const response = await checkEndpoint(post({ text: "A draft." }), { ...env, STATS: namespace } as unknown as Env, allowed, ctx);
    expect(response.status).toBe(200);
    expect(later).toHaveLength(1);
    release();
    await Promise.all(later);
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
