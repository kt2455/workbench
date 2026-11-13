import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDraft, checkEndpoint, type ModelAccess } from "../src/check";
import { withErrorHandling } from "../src/http";
import { logCheck, type CheckLog } from "../src/log";
import { BOT_CHECK_PASS, CHECK_URL, fakeNetwork, newVisitor, ORIGIN, post, providerMessage } from "./helpers";

/** A draft with a word no log line could contain by accident. */
const MARKER = "Zanzibarquest";
const DRAFT = `Last month we stopped sending status reports about ${MARKER}. It turns out nobody read them.`;

/** Every field a check line may have. Anything else is a leak. */
const CHECK_FIELDS = [
  "event",
  "at",
  "result",
  "status",
  "guardrail",
  "durationMs",
  "characters",
  "modelStep",
  "model",
  "promptVersion",
  "modelMs",
  "inputTokens",
  "outputTokens",
  "costMicros",
  "costUsd",
  "verdict",
  "findings",
].sort();

const on = { ...env, MODEL_ENABLED: "true" };
const allowed = { kind: "allowed", origin: ORIGIN } as const;
const modelReply = providerMessage(JSON.stringify({ verdict: "clean", summary: "Reads naturally.", findings: [] }));

/** Catches what the Worker writes to the log during one test. */
function captureLog() {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  return {
    lines: () => spy.mock.calls.map((call) => String(call[0])),
    entries: () => spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>),
  };
}

/** The checks every log line must pass, whatever happened. */
function expectPrivate(line: string, visitor: string) {
  expect(line).not.toContain(MARKER);
  expect(line).not.toContain("status reports");
  expect(line).not.toContain(visitor);
  expect(line).not.toContain("token-from-the-page");
  expect(line).not.toContain("kyletebo");
  expect(line).not.toContain(env.MODEL_API_KEY);
}

afterEach(() => vi.restoreAllMocks());

describe("the log line for each check", () => {
  it("records a quick check with the model switched off", async () => {
    fakeNetwork();
    const log = captureLog();
    const visitor = newVisitor();
    await exports.default.fetch(post({ text: DRAFT }, {}, visitor));

    expect(log.lines()).toHaveLength(1);
    expectPrivate(log.lines()[0], visitor);
    const [entry] = log.entries();
    expect(Object.keys(entry).sort()).toEqual(CHECK_FIELDS);
    expect(entry).toMatchObject({
      event: "check",
      result: "quick",
      status: 200,
      guardrail: null,
      // The length is rounded up to the next 100.
      characters: 100,
      modelStep: "switched_off",
      model: null,
      promptVersion: "v1",
      modelMs: null,
      inputTokens: null,
      outputTokens: null,
      costMicros: 0,
      costUsd: 0,
      verdict: null,
      // The rules found "It turns out".
      findings: { total: 1, byType: { signpost: 1 }, byLayer: { rule: 1, model: 0, both: 0 } },
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(Date.parse(String(entry.at))).not.toBeNaN();
  });

  it("records a full check: the model, tokens, cost and speed", async () => {
    fakeNetwork({ model: modelReply });
    const log = captureLog();
    const visitor = newVisitor();
    await checkEndpoint(post({ text: DRAFT }, {}, visitor), on, allowed);

    expect(log.lines()).toHaveLength(1);
    expectPrivate(log.lines()[0], visitor);
    const [entry] = log.entries();
    expect(Object.keys(entry).sort()).toEqual(CHECK_FIELDS);
    expect(entry).toMatchObject({
      result: "full",
      status: 200,
      guardrail: null,
      modelStep: "ok",
      model: env.TELLS_CHECKER_MODEL,
      inputTokens: 2400,
      outputTokens: 300,
      // 2,400 tokens at $0.10 a million plus 300 at $0.50 a million.
      costMicros: 390,
      costUsd: 0.00039,
      verdict: "a_few_tells",
      findings: { total: 1, byType: { signpost: 1 }, byLayer: { rule: 1, model: 0, both: 0 } },
    });
    expect(typeof entry.modelMs).toBe("number");
  });

  it("records the daily budget as the guardrail that fired", async () => {
    fakeNetwork({ model: modelReply });
    const log = captureLog();
    await checkEndpoint(post({ text: DRAFT }), { ...on, DAILY_BUDGET_USD: "0.000001" }, allowed);
    expect(log.entries()[0]).toMatchObject({
      result: "quick",
      guardrail: "daily_budget",
      modelStep: "budget_reached",
      model: null,
      costMicros: 0,
      costUsd: 0,
    });
  });

  it("records a broken setting, so it can be spotted", async () => {
    fakeNetwork();
    const log = captureLog();
    await checkEndpoint(post({ text: DRAFT }), { ...on, MODEL_INPUT_USD_PER_MTOK: "" }, allowed);
    expect(log.entries()[0]).toMatchObject({ result: "quick", guardrail: null, modelStep: "settings_broken" });
  });

  it("records a provider outage without the provider's message", async () => {
    fakeNetwork({ model: { type: "error", error: { type: "api_error", message: `echo of ${MARKER}` } }, modelStatus: 500 });
    const log = captureLog();
    const visitor = newVisitor();
    await checkEndpoint(post({ text: DRAFT }, {}, visitor), on, allowed);
    expectPrivate(log.lines()[0], visitor);
    // No bill came back, so the whole reservation is counted as spent.
    const entry = log.entries()[0];
    expect(entry).toMatchObject({ result: "quick", modelStep: "unavailable", inputTokens: null });
    expect(entry.costMicros).toBeGreaterThan(0);
  });

  it.each([
    ["a refusal", providerMessage("", "refusal"), "refused"],
    ["a reply cut short", providerMessage('{"verdict":"cle', "max_tokens"), "truncated"],
    ["a reply in the wrong shape", providerMessage(`{"note":"${MARKER}"}`), "unreadable_reply"],
  ])("records %s, and that it was still charged", async (_name, model, step) => {
    fakeNetwork({ model });
    const log = captureLog();
    const visitor = newVisitor();
    await checkEndpoint(post({ text: DRAFT }, {}, visitor), on, allowed);
    expectPrivate(log.lines()[0], visitor);
    expect(log.entries()[0]).toMatchObject({ modelStep: step, inputTokens: 2400, outputTokens: 300, costMicros: 390 });
  });

  it("records an unreachable budget counter", async () => {
    const access: ModelAccess = {
      model: "some-model",
      prices: { limitMicros: 1_000_000, inputMicrosPerToken: 0.1, outputMicrosPerToken: 0.5 },
      budget: {
        reserve: async () => {
          throw new Error("counter offline");
        },
        settle: async () => {},
      },
      caller: async () => {
        throw new Error("the model must not be called");
      },
    };
    const outcome = await checkDraft(DRAFT, access);
    expect(outcome).toMatchObject({ modelStep: "budget_unavailable", costMicros: 0, modelMs: null });
  });
});

describe("the log line for each refusal", () => {
  it.each([
    ["the size cap", () => post({ text: "a".repeat(Number(env.MAX_DRAFT_CHARS) + 1) }), "text_too_long", 413, "size_cap"],
    ["the bot check", () => post({ text: DRAFT }), "bot_check_failed", 403, "bot_check"],
    ["a malformed request", () => post({ text: 42 }), "invalid_request", 400, null],
    ["a bad houseStyle", () => post({ text: DRAFT, houseStyle: "yes" }), "invalid_request", 400, null],
    ["the wrong content type", () => post({ text: DRAFT }, { "content-type": "text/plain" }), "invalid_request", 400, null],
  ])("records %s", async (_name, build, result, status, guardrail) => {
    fakeNetwork({ botCheck: { success: false } });
    const log = captureLog();
    const request = build();
    const visitor = request.headers.get("cf-connecting-ip") ?? "";
    const response = await exports.default.fetch(request);
    expect(response.status).toBe(status);

    expect(log.lines()).toHaveLength(1);
    expectPrivate(log.lines()[0], visitor);
    const [entry] = log.entries();
    expect(Object.keys(entry).sort()).toEqual(CHECK_FIELDS);
    expect(entry).toMatchObject({ event: "check", result, status, guardrail, modelStep: null, costUsd: null, findings: null });
  });

  it("records the rate limit", async () => {
    fakeNetwork({ botCheck: BOT_CHECK_PASS });
    const visitor = newVisitor();
    for (let i = 0; i < 5; i += 1) await exports.default.fetch(post({ text: DRAFT }, {}, visitor));
    const log = captureLog();
    const response = await exports.default.fetch(post({ text: DRAFT }, {}, visitor));
    expect(response.status).toBe(429);
    expectPrivate(log.lines()[0], visitor);
    expect(log.entries()).toEqual([
      expect.objectContaining({ result: "rate_limited", status: 429, guardrail: "rate_limit", characters: null }),
    ]);
    expect(Object.keys(log.entries()[0]).sort()).toEqual(CHECK_FIELDS);
  });

  it("records a page on another website, without the address it asked for", async () => {
    const log = captureLog();
    await exports.default.fetch(
      new Request(`${CHECK_URL}?q=${MARKER}`, { method: "POST", headers: { origin: "https://example.com" }, body: DRAFT }),
    );
    expect(log.lines()).toHaveLength(1);
    expect(log.lines()[0]).not.toContain(MARKER);
    expect(log.lines()[0]).not.toContain("example.com");
    expect(log.lines()[0]).not.toContain("/check");
    expect(log.entries()[0]).toEqual({ event: "refused", at: expect.any(String), guardrail: "origin", status: 403 });
  });

  it("writes nothing for an ordinary visit to /hello", async () => {
    const log = captureLog();
    await exports.default.fetch(new Request("https://api.kyletebo.com/hello", { headers: { origin: ORIGIN } }));
    expect(log.lines()).toHaveLength(0);
  });
});

describe("the log line in harder cases", () => {
  it("records an unreachable budget counter as the daily budget guardrail", async () => {
    fakeNetwork({ model: modelReply });
    const log = captureLog();
    const offline = {
      idFromName: () => ({}),
      get: () => ({
        reserve: async () => {
          throw new Error("counter offline");
        },
        settle: async () => {},
      }),
    };
    const response = await checkEndpoint(post({ text: DRAFT }), { ...on, BUDGET: offline } as unknown as Env, allowed);
    expect(await response.json()).toMatchObject({ mode: "quick", notice: "model_unavailable" });
    expect(log.entries()[0]).toMatchObject({
      result: "quick",
      guardrail: "daily_budget",
      modelStep: "budget_unavailable",
      model: null,
      costMicros: 0,
    });
  });

  it("still records the cost when settling the budget fails", async () => {
    const access: ModelAccess = {
      model: "some-model",
      prices: { limitMicros: 1_000_000, inputMicrosPerToken: 0.1, outputMicrosPerToken: 0.5 },
      budget: {
        reserve: async () => true,
        settle: async () => {
          throw new Error("counter offline");
        },
      },
      caller: async () => ({ ok: true, text: JSON.stringify({ verdict: "clean", summary: "Fine.", findings: [] }), inputTokens: 900, outputTokens: 120 }),
    };
    const outcome = await checkDraft(DRAFT, access);
    // 900 at 0.1 plus 120 at 0.5.
    expect(outcome).toMatchObject({ modelStep: "ok", costMicros: 150 });
  });

  it("records a huge body refused before it was read, with no length", async () => {
    fakeNetwork();
    const log = captureLog();
    const response = await exports.default.fetch(post({ text: "a".repeat(200_000) }));
    expect(response.status).toBe(413);
    expect(log.entries()).toEqual([expect.objectContaining({ result: "text_too_long", guardrail: "size_cap", characters: null })]);
  });

  it("rounds the length up to the next 100", async () => {
    fakeNetwork();
    const log = captureLog();
    await exports.default.fetch(post({ text: "a".repeat(101) }));
    await exports.default.fetch(post({ text: "a".repeat(200) }));
    expect(log.entries().map((entry) => entry.characters)).toEqual([200, 200]);
  });

  it("writes no check line when something unexpected fails, only the safety net's fixed line", async () => {
    fakeNetwork();
    const log = captureLog();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = withErrorHandling((request, brokenEnv) => checkEndpoint(request, brokenEnv, allowed));
    const response = await broken(post({ text: DRAFT }), { ...env, MAX_DRAFT_CHARS: "lots" });
    expect(response.status).toBe(500);
    expect(log.lines()).toHaveLength(0);
    expect(errors.mock.calls).toEqual([[JSON.stringify({ event: "unhandled_error" })]]);
  });

  it("still answers the visitor if writing the log fails", async () => {
    fakeNetwork();
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("log unavailable");
    });
    const response = await exports.default.fetch(post({ text: DRAFT }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "quick" });
  });
});

describe("logCheck", () => {
  it("writes only the allowed fields, even if handed more", () => {
    const log = captureLog();
    const sneaky = {
      result: "quick",
      status: 200,
      guardrail: null,
      durationMs: 3,
      characters: 10,
      modelStep: "switched_off",
      model: null,
      promptVersion: "v1",
      modelMs: null,
      inputTokens: null,
      outputTokens: null,
      costMicros: 0,
      costUsd: 0,
      verdict: "clean",
      findings: { total: 1, byType: { staccato: 1, [MARKER]: 1 }, byLayer: { rule: 1, model: 0, both: 0, note: MARKER } },
      text: MARKER,
      ip: "203.0.113.9",
    } as unknown as CheckLog;
    logCheck(sneaky);
    expect(log.lines()[0]).not.toContain(MARKER);
    expect(log.lines()[0]).not.toContain("203.0.113.9");
    expect(Object.keys(log.entries()[0]).sort()).toEqual(CHECK_FIELDS);
    expect(log.entries()[0].findings).toEqual({ total: 1, byType: { staccato: 1 }, byLayer: { rule: 1, model: 0, both: 0 } });
  });

  it("never lets a broken number through as something else", () => {
    const log = captureLog();
    logCheck({
      result: "quick",
      status: 200,
      guardrail: null,
      durationMs: Number.NaN,
      characters: Number.POSITIVE_INFINITY,
      modelStep: null,
      model: null,
      promptVersion: null,
      modelMs: null,
      inputTokens: null,
      outputTokens: null,
      costMicros: null,
      costUsd: null,
      verdict: "definitely_a_robot" as CheckLog["verdict"],
      findings: null,
    });
    expect(log.entries()[0]).toMatchObject({ durationMs: null, characters: null, verdict: null });
  });
  it("checks every word field against its list while running, not only when written", () => {
    const log = captureLog();
    logCheck({
      result: `quick ${MARKER}`,
      status: 200,
      guardrail: MARKER,
      durationMs: 3,
      characters: 10,
      modelStep: `upstream said: ${MARKER}`,
      model: `model ${MARKER}`,
      promptVersion: "v1\nwith a second line",
      modelMs: null,
      inputTokens: null,
      outputTokens: null,
      costMicros: 0,
      costUsd: 0,
      verdict: null,
      findings: null,
    } as unknown as CheckLog);
    expect(log.lines()[0]).not.toContain(MARKER);
    expect(log.entries()[0]).toMatchObject({
      result: null,
      guardrail: null,
      modelStep: null,
      model: null,
      promptVersion: null,
    });
  });
});
